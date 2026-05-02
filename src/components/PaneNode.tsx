import { useEffect, useRef, useState } from 'react';
import { workspace, type PaneTree } from '../state/workspace';
import { Pane } from './Pane';

interface Props {
  node: PaneTree;
  /** Owning session — threaded down so leaves resolve against the right tree
   *  even when this session isn't currently the active one (we keep inactive
   *  sessions mounted to preserve <webview> playback, terminal output, etc.). */
  sessionId: string;
}

export function PaneNode({ node, sessionId }: Props) {
  if (node.kind === 'leaf') {
    return <Pane leaf={node} sessionId={sessionId} />;
  }
  return (
    <SplitContainer
      id={node.id}
      direction={node.direction}
      ratio={node.ratio}
      first={<PaneNode node={node.children[0]} sessionId={sessionId} />}
      second={<PaneNode node={node.children[1]} sessionId={sessionId} />}
    />
  );
}

function SplitContainer({
  id,
  direction,
  ratio,
  first,
  second,
}: {
  id: string;
  direction: 'horizontal' | 'vertical';
  ratio: number;
  first: React.ReactNode;
  second: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  // Latest mouse position the rAF loop hasn't applied yet. We coalesce
  // many mousemove events into one ratio update per frame — without this
  // the editor + terminal panes burn CPU re-rendering on every event.
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  // Drag lifecycle: while `dragging` is true we render a full-window
  // overlay that captures all pointer events (webviews and iframes
  // otherwise swallow them in their own processes, which is what made
  // the splitter feel stuck mid-drag). Mouse events fire on the overlay,
  // ratio updates flow through a rAF queue.
  useEffect(() => {
    if (!dragging) return;
    const flush = () => {
      rafRef.current = null;
      const p = pendingRef.current;
      const c = containerRef.current;
      if (!p || !c) return;
      const r = c.getBoundingClientRect();
      const next =
        direction === 'horizontal'
          ? (p.x - r.left) / r.width
          : (p.y - r.top) / r.height;
      workspace.setSplitRatio(id, next);
    };
    const queue = (x: number, y: number) => {
      pendingRef.current = { x, y };
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    };
    const onMove = (e: MouseEvent) => queue(e.clientX, e.clientY);
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingRef.current = null;
    };
  }, [dragging, direction, id]);

  const onSplitterDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  return (
    <div
      ref={containerRef}
      className={`split split--${direction}`}
      style={{ flexDirection: direction === 'horizontal' ? 'row' : 'column' }}
    >
      <div className="split-child" style={{ flex: ratio, minWidth: 0, minHeight: 0 }}>
        {first}
      </div>
      <div
        className={`splitter splitter--${direction}`}
        onMouseDown={onSplitterDown}
        role="separator"
        aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
      />
      <div className="split-child" style={{ flex: 1 - ratio, minWidth: 0, minHeight: 0 }}>
        {second}
      </div>
      {dragging && (
        <div
          className={`splitter-drag-overlay splitter-drag-overlay--${direction}`}
          aria-hidden
        />
      )}
    </div>
  );
}
