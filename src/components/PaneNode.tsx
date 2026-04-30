import { useEffect, useRef } from 'react';
import { workspace, type PaneTree } from '../state/workspace';
import { Pane } from './Pane';

interface Props {
  node: PaneTree;
}

export function PaneNode({ node }: Props) {
  if (node.kind === 'leaf') {
    return <Pane leaf={node} />;
  }
  return (
    <SplitContainer
      id={node.id}
      direction={node.direction}
      ratio={node.ratio}
      first={<PaneNode node={node.children[0]} />}
      second={<PaneNode node={node.children[1]} />}
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
  const draggingRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const c = containerRef.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const next =
        direction === 'horizontal'
          ? (e.clientX - r.left) / r.width
          : (e.clientY - r.top) / r.height;
      workspace.setSplitRatio(id, next);
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
  }, [id, direction]);

  const onSplitterDown = () => {
    draggingRef.current = true;
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
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
    </div>
  );
}
