import { useMemo } from 'react';
import { useWorkspace, findLeaf, getActiveSession } from '../state/workspace';
import { CodeMinimap } from './CodeMinimap';
import { FolderPreview } from './FolderPreview';

interface Heading {
  level: number;
  text: string;
  line: number;
}

function extractHeadings(markdown: string): Heading[] {
  const lines = markdown.split('\n');
  const headings: Heading[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      headings.push({ level: m[1].length, text: m[2], line: i });
    }
  }
  return headings;
}

export function Outline() {
  const activeTab = useWorkspace((s) => {
    const session = getActiveSession(s);
    const focused = findLeaf(session.root, session.focusedLeafId);
    if (!focused?.activeTabId) return null;
    return s.tabs.find((t) => t.id === focused.activeTabId) ?? null;
  });
  const headings = useMemo(
    () => (activeTab ? extractHeadings(activeTab.content) : []),
    [activeTab?.content],
  );

  const jumpTo = (index: number) => {
    if (!activeTab) return;
    if (activeTab.kind === 'markdown') {
      const focused = document.querySelector('.pane.pane--focused');
      if (!focused) return;
      const els = focused.querySelectorAll<HTMLElement>(
        '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6',
      );
      const target = els[index];
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Brief flash to anchor the eye.
      target.classList.add('outline-flash');
      setTimeout(() => target.classList.remove('outline-flash'), 800);
    } else if (activeTab.kind === 'code') {
      // For code editors, scroll the CodeMirror view to the heading's line.
      const focused = document.querySelector('.pane.pane--focused');
      const cm = focused?.querySelector<HTMLElement>('.cm-scroller');
      const lines = focused?.querySelectorAll<HTMLElement>('.cm-line');
      const heading = headings[index];
      if (cm && lines && heading) {
        const lineEl = lines[heading.line];
        lineEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  if (activeTab?.kind === 'code') {
    return (
      <div className="outline-inner">
        <OutlineHeader title="Minimap" />
        <CodeMinimap content={activeTab.content} />
      </div>
    );
  }

  if (activeTab?.kind === 'folder') {
    return <FolderPreviewSection tabId={activeTab.id} />;
  }

  return (
    <div className="outline-inner">
      <OutlineHeader title="Outline" />
      <div className="outline-list">
        {headings.length === 0 ? (
          <div className="outline-empty">No headings.</div>
        ) : (
          headings.map((h, i) => (
            <button
              key={i}
              className="outline-item"
              style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
              onClick={() => jumpTo(i)}
              title={h.text}
            >
              {h.text}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function FolderPreviewSection({ tabId }: { tabId: string }) {
  const info = useWorkspace((s) => s.folderSelection);
  const headerText =
    info && info.tabId === tabId
      ? info.selected.length === 0
        ? 'Folder Info'
        : info.selected.length === 1
          ? 'Preview'
          : 'Selection'
      : 'Preview';
  return (
    <div className="outline-inner">
      <OutlineHeader title={headerText} />
      {info && info.tabId === tabId ? (
        <FolderPreview info={info} />
      ) : (
        <div className="outline-empty">Loading…</div>
      )}
    </div>
  );
}

/** Outline section header. Toggle lives in the rightmost pane's
 *  tab bar (TabBar.tsx → OutlineRevealButton) so it stays put across
 *  open/close without shifting. */
function OutlineHeader({ title }: { title: string }) {
  return (
    <div className="outline-header">
      <span>{title}</span>
    </div>
  );
}
