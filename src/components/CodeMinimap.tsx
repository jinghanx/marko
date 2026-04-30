import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  content: string;
}

const ROW_HEIGHT = 2.4; // px per line in the minimap

type LineClass = 'plain' | 'comment' | 'decl' | 'empty';

function classify(line: string): LineClass {
  const t = line.trim();
  if (!t) return 'empty';
  if (t.startsWith('//') || t.startsWith('#') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('--')) {
    return 'comment';
  }
  if (
    /^(export\s+)?(async\s+)?(function|class|fn|def|struct|enum|trait|impl|interface|type|const|let|var|import|public|private|module)\b/.test(t)
  ) {
    return 'decl';
  }
  return 'plain';
}

export function CodeMinimap({ content }: Props) {
  const lines = useMemo(() => content.split('\n'), [content]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<{ top: number; height: number; total: number } | null>(null);

  // Track the focused pane's CodeMirror scroller and update viewport indicator.
  useEffect(() => {
    let scroller: HTMLElement | null = null;
    let raf = 0;
    const findScroller = () => {
      const focused = document.querySelector('.pane.pane--focused');
      return focused?.querySelector<HTMLElement>('.cm-scroller') ?? null;
    };
    const update = () => {
      raf = 0;
      if (!scroller) scroller = findScroller();
      if (!scroller) return;
      const total = scroller.scrollHeight;
      const top = scroller.scrollTop;
      const height = scroller.clientHeight;
      if (total <= 0) return;
      setViewport({ top: top / total, height: height / total, total });
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    // Initial poll loop until scroller appears.
    let pollAttempts = 0;
    const poll = () => {
      scroller = findScroller();
      if (scroller) {
        scroller.addEventListener('scroll', onScroll, { passive: true });
        update();
        return;
      }
      if (pollAttempts++ < 30) setTimeout(poll, 100);
    };
    poll();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      scroller?.removeEventListener('scroll', onScroll);
    };
  }, [content]);

  const onJumpToLine = (lineIdx: number) => {
    const focused = document.querySelector('.pane.pane--focused');
    const lineEls = focused?.querySelectorAll<HTMLElement>('.cm-line');
    const target = lineEls?.[lineIdx];
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const onClickArea = (e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    const lineIdx = Math.max(0, Math.min(lines.length - 1, Math.floor(ratio * lines.length)));
    onJumpToLine(lineIdx);
  };

  return (
    <div className="minimap" ref={containerRef} onClick={onClickArea}>
      {viewport && (
        <div
          className="minimap-viewport"
          style={{
            top: `${viewport.top * 100}%`,
            height: `${Math.max(2, viewport.height * 100)}%`,
          }}
        />
      )}
      <div className="minimap-rows">
        {lines.map((line, i) => {
          const cls = classify(line);
          const len = line.length;
          // Width relative to ~120 columns; clamp to 100%.
          const w = Math.min(100, (len / 120) * 100);
          return (
            <div
              key={i}
              className={`minimap-row minimap-row--${cls}`}
              style={{ height: ROW_HEIGHT }}
              title={`Line ${i + 1}`}
            >
              {cls !== 'empty' && (
                <span className="minimap-bar" style={{ width: `${w}%` }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
