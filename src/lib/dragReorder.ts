import { useCallback, useState } from 'react';

export type DropSide = 'before' | 'after';

export interface DragReorderState {
  /** Index of the row currently being dragged, or null if nothing is dragging. */
  dragIdx: number | null;
  /** Where the drop indicator should render, if any. */
  overIdx: number | null;
  overSide: DropSide | null;
}

export interface DragReorderHandlers {
  onDragStart: (idx: number) => (e: React.DragEvent) => void;
  onDragOver: (idx: number) => (e: React.DragEvent) => void;
  onDrop: (idx: number) => (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

/** Tiny shared hook for HTML5 drag reordering of horizontally-laid-out rows.
 *  Caller provides a `commit(from, to)` callback; the hook computes the target
 *  insertion index from cursor position vs. each row's midpoint. */
export function useDragReorder(commit: (from: number, to: number) => void): {
  state: DragReorderState;
  handlers: DragReorderHandlers;
} {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [overSide, setOverSide] = useState<DropSide | null>(null);

  const reset = useCallback(() => {
    setDragIdx(null);
    setOverIdx(null);
    setOverSide(null);
  }, []);

  const onDragStart = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      // Some browsers refuse to start a drag without setData.
      try {
        e.dataTransfer.setData('text/x-marko-reorder', String(idx));
      } catch {
        // ignore
      }
      setDragIdx(idx);
    },
    [],
  );

  const onDragOver = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      if (dragIdx === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const side: DropSide = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
      if (overIdx !== idx || overSide !== side) {
        setOverIdx(idx);
        setOverSide(side);
      }
    },
    [dragIdx, overIdx, overSide],
  );

  const onDrop = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      if (dragIdx === null) {
        reset();
        return;
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const side: DropSide = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
      let target = idx + (side === 'after' ? 1 : 0);
      // Removing the source first shifts indices after it left by one.
      if (target > dragIdx) target -= 1;
      if (target !== dragIdx) commit(dragIdx, target);
      reset();
    },
    [dragIdx, commit, reset],
  );

  return {
    state: { dragIdx, overIdx, overSide },
    handlers: {
      onDragStart,
      onDragOver,
      onDrop,
      onDragEnd: reset,
    },
  };
}
