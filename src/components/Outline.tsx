import { useMemo } from 'react';
import { useWorkspace } from '../state/workspace';

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
  const activeTab = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const headings = useMemo(() => (activeTab ? extractHeadings(activeTab.content) : []), [activeTab?.content]);

  return (
    <div className="outline-inner">
      <div className="outline-header">Outline</div>
      <div className="outline-list">
        {headings.length === 0 ? (
          <div className="outline-empty">No headings.</div>
        ) : (
          headings.map((h, i) => (
            <div key={i} className="outline-item" style={{ paddingLeft: 8 + (h.level - 1) * 12 }}>
              {h.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
