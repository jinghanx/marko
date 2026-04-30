import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../state/workspace';
import { CodeEditor } from './CodeEditor';
import { MarkdownPreview } from './MarkdownPreview';

interface Props {
  tabId: string;
  initialValue: string;
  filePath: string | null;
}

export function MarkdownSplitView({ tabId, initialValue, filePath }: Props) {
  const [ratio, setRatio] = useState(0.5);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  // Pull live content out of workspace so the preview tracks edits.
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

  return (
    <div className="md-split" ref={containerRef}>
      <div className="md-split-pane" style={{ flex: ratio }}>
        <CodeEditor
          tabId={tabId}
          initialValue={initialValue}
          filePath={filePath}
          language="markdown"
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
        <MarkdownPreview content={content} />
      </div>
    </div>
  );
}
