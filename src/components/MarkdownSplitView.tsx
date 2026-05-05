import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorView } from 'codemirror';
import { useWorkspace } from '../state/workspace';
import { CodeEditor } from './CodeEditor';
import { MarkdownPreview } from './MarkdownPreview';

interface Props {
  tabId: string;
  initialValue: string;
  filePath: string | null;
}

// While one side is driving the scroll, the other side's listener should
// ignore its own (programmatic) scroll events so we don't ping-pong. The
// timer expires shortly after the last programmatic scroll lands.
const SYNC_LOCK_MS = 120;

export function MarkdownSplitView({ tabId, initialValue, filePath }: Props) {
  const [ratio, setRatio] = useState(0.5);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const syncOwnerRef = useRef<'editor' | 'preview' | null>(null);
  const syncTimerRef = useRef<number | null>(null);

  const content = useWorkspace((s) => s.tabs.find((t) => t.id === tabId)?.content ?? '');

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const c = containerRef.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const next = (e.clientX - r.left) / r.width;
      setRatio(Math.max(0.15, Math.min(0.85, next)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const claimSync = useCallback((owner: 'editor' | 'preview') => {
    syncOwnerRef.current = owner;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      syncOwnerRef.current = null;
      syncTimerRef.current = null;
    }, SYNC_LOCK_MS);
  }, []);

  // Editor → preview: find the source line at the editor viewport top, then
  // scroll the preview so the matching block element sits at the top.
  const syncEditorToPreview = useCallback(() => {
    if (syncOwnerRef.current === 'preview') return;
    const view = editorViewRef.current;
    const scroll = previewScrollRef.current;
    if (!view || !scroll) return;
    const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop - view.documentTop);
    const sourceLine = view.state.doc.lineAt(block.from).number - 1;
    const target = findBlockAtOrBefore(scroll, sourceLine);
    if (!target) return;
    claimSync('editor');
    const scrollRect = scroll.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    scroll.scrollTop += targetRect.top - scrollRect.top;
  }, [claimSync]);

  // Preview → editor: find the topmost visible block in the preview, then
  // scroll the editor to that source line.
  const syncPreviewToEditor = useCallback(() => {
    if (syncOwnerRef.current === 'editor') return;
    const view = editorViewRef.current;
    const scroll = previewScrollRef.current;
    if (!view || !scroll) return;
    const target = findFirstVisibleBlock(scroll);
    if (!target) return;
    const sourceLine = parseInt(target.dataset.sourceLine ?? '0', 10);
    const lineNum = Math.min(view.state.doc.lines, Math.max(1, sourceLine + 1));
    const linePos = view.state.doc.line(lineNum);
    const block = view.lineBlockAt(linePos.from);
    claimSync('preview');
    view.scrollDOM.scrollTop = block.top;
  }, [claimSync]);

  // Attach scroll listener to CodeMirror once the view is ready.
  const handleEditorReady = useCallback(
    (view: EditorView) => {
      const prev = editorViewRef.current;
      if (prev) prev.scrollDOM.removeEventListener('scroll', syncEditorToPreview);
      editorViewRef.current = view;
      view.scrollDOM.addEventListener('scroll', syncEditorToPreview, { passive: true });
    },
    [syncEditorToPreview],
  );

  useEffect(() => {
    return () => {
      const view = editorViewRef.current;
      if (view) view.scrollDOM.removeEventListener('scroll', syncEditorToPreview);
      editorViewRef.current = null;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [syncEditorToPreview]);

  useEffect(() => {
    const scroll = previewScrollRef.current;
    if (!scroll) return;
    scroll.addEventListener('scroll', syncPreviewToEditor, { passive: true });
    return () => scroll.removeEventListener('scroll', syncPreviewToEditor);
  }, [syncPreviewToEditor]);

  return (
    <div className="md-split" ref={containerRef}>
      <div className="md-split-pane" style={{ flex: ratio }}>
        <CodeEditor
          tabId={tabId}
          initialValue={initialValue}
          filePath={filePath}
          language="markdown"
          onReady={handleEditorReady}
        />
      </div>
      <div
        className="md-split-divider"
        onMouseDown={() => {
          draggingRef.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        role="separator"
        aria-orientation="vertical"
      />
      <div className="md-split-pane md-split-pane--preview" style={{ flex: 1 - ratio }}>
        <MarkdownPreview ref={previewScrollRef} content={content} debounceMs={80} />
      </div>
    </div>
  );
}

function findBlockAtOrBefore(scroll: HTMLElement, sourceLine: number): HTMLElement | null {
  const blocks = scroll.querySelectorAll<HTMLElement>('[data-source-line]');
  let best: HTMLElement | null = null;
  for (const el of Array.from(blocks)) {
    const line = parseInt(el.dataset.sourceLine ?? '0', 10);
    if (line <= sourceLine) best = el;
    else break;
  }
  return best ?? (blocks.length ? blocks[0] : null);
}

function findFirstVisibleBlock(scroll: HTMLElement): HTMLElement | null {
  const blocks = scroll.querySelectorAll<HTMLElement>('[data-source-line]');
  const scrollRect = scroll.getBoundingClientRect();
  let last: HTMLElement | null = null;
  for (const el of Array.from(blocks)) {
    const r = el.getBoundingClientRect();
    if (r.top >= scrollRect.top - 4) return el;
    last = el;
  }
  return last;
}
