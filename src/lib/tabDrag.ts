import { useCallback, useState } from 'react';

export type DropSide = 'before' | 'after';

/** Custom MIME type used to carry the source-pane info for cross-pane tab
 *  drags. Reading this from `dataTransfer` lets ANY pane's TabBar identify
 *  the originating pane on drop. */
const TAB_DND_MIME = 'application/x-marko-tab-move';

interface TabDragPayload {
  fromLeafId: string;
  fromIdx: number;
}

export interface TabDragState {
  /** Index of the row being dragged out of THIS pane, or null. Other panes
   *  see null even while a foreign drag is in progress — they should look
   *  at their own overIdx for visual feedback. */
  dragIdx: number | null;
  overIdx: number | null;
  overSide: DropSide | null;
}

/** Drag-and-drop reorder for tab strips, supporting both same-pane reorder
 *  and cross-pane move. The `commit` callback receives source + target
 *  leafIds, so the workspace state can route appropriately. */
export function useTabDrag(
  leafId: string,
  tabIds: string[],
  commit: (fromLeafId: string, fromIdx: number, toLeafId: string, toIdx: number) => void,
) {
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
      const tabId = tabIds[idx];
      if (!tabId) return;
      e.dataTransfer.effectAllowed = 'move';
      const payload: TabDragPayload = { fromLeafId: leafId, fromIdx: idx };
      try {
        e.dataTransfer.setData(TAB_DND_MIME, JSON.stringify(payload));
      } catch {
        // ignore — some browsers are restrictive about dataTransfer.setData
        // payloads, but our MIME is safe.
      }
      setDragIdx(idx);
    },
    [leafId, tabIds],
  );

  /** Read `dataTransfer.types` to confirm a Marko tab is in flight. We
   *  can't read the actual payload value during dragover (security), but
   *  the type list is available, which is enough to show drop indicators. */
  const isMarkoTabDrag = (e: React.DragEvent): boolean =>
    e.dataTransfer.types.includes(TAB_DND_MIME);

  const onDragOver = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      if (!isMarkoTabDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const side: DropSide = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
      if (overIdx !== idx || overSide !== side) {
        setOverIdx(idx);
        setOverSide(side);
      }
    },
    [overIdx, overSide],
  );

  const onDrop = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(TAB_DND_MIME);
      reset();
      if (!raw) return;
      let payload: TabDragPayload;
      try {
        payload = JSON.parse(raw) as TabDragPayload;
      } catch {
        return;
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const side: DropSide = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
      let target = idx + (side === 'after' ? 1 : 0);
      // Same-leaf reorder: removing the source first shifts indices
      // after it left by one.
      if (payload.fromLeafId === leafId && target > payload.fromIdx) target -= 1;
      if (payload.fromLeafId === leafId && target === payload.fromIdx) return;
      commit(payload.fromLeafId, payload.fromIdx, leafId, target);
    },
    [leafId, commit, reset],
  );

  /** Handler for dropping anywhere on the tab strip's empty area (after
   *  the last tab). Appends to the end of this leaf. */
  const onStripDragOver = useCallback((e: React.DragEvent) => {
    if (!isMarkoTabDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onStripDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(TAB_DND_MIME);
      reset();
      if (!raw) return;
      let payload: TabDragPayload;
      try {
        payload = JSON.parse(raw) as TabDragPayload;
      } catch {
        return;
      }
      // Append to end. For same-leaf no-op, stops here.
      const target = tabIds.length;
      if (payload.fromLeafId === leafId && payload.fromIdx === target - 1) return;
      const adjusted =
        payload.fromLeafId === leafId && target > payload.fromIdx ? target - 1 : target;
      if (payload.fromLeafId === leafId && adjusted === payload.fromIdx) return;
      commit(payload.fromLeafId, payload.fromIdx, leafId, adjusted);
    },
    [leafId, tabIds.length, commit, reset],
  );

  return {
    state: { dragIdx, overIdx, overSide },
    handlers: {
      onDragStart,
      onDragOver,
      onDrop,
      onDragEnd: reset,
      onStripDragOver,
      onStripDrop,
    },
  };
}
