/**
 * Live preview of block reordering during drag.
 *
 * Crepe shows only a thin drop-indicator line during a block drag. This module
 * makes neighbouring blocks visibly shift in real time so the user can foresee
 * the resulting layout. The actual document mutation still happens on drop —
 * we only animate the DOM via CSS transforms.
 */

interface CachedRect {
  top: number;
  bottom: number;
  height: number;
}

const TRANSITION = 'transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)';

export function attachBlockDragPreview(rootEl: HTMLElement): () => void {
  let proseMirror: HTMLElement | null = null;
  let siblings: HTMLElement[] = [];
  let rects: CachedRect[] = [];
  let sourceIndex = -1;
  let sourceHeight = 0;
  let active = false;

  const findProseMirror = () => rootEl.querySelector<HTMLElement>('.ProseMirror');

  const reset = () => {
    if (!active) return;
    active = false;
    siblings.forEach((el) => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
      el.style.pointerEvents = '';
    });
    siblings = [];
    rects = [];
    sourceIndex = -1;
    sourceHeight = 0;
  };

  const findSourceBlock = (pm: HTMLElement): HTMLElement | null => {
    // ProseMirror sets `.ProseMirror-selectednode` on the source's DOM during a
    // NodeSelection (which Crepe creates when you grab the block handle).
    const selected = pm.querySelector<HTMLElement>('.ProseMirror-selectednode');
    if (selected) {
      let el: HTMLElement | null = selected;
      while (el && el.parentElement !== pm) el = el.parentElement;
      if (el) return el;
    }
    // Fallback: probe just to the right of the block handle.
    const handle = document.querySelector<HTMLElement>('.milkdown-block-handle');
    if (!handle) return null;
    const r = handle.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const probeX = r.right + 12;
    const probeY = r.top + r.height / 2;
    const stack = document.elementsFromPoint(probeX, probeY);
    for (const el of stack) {
      if (el.parentElement === pm && el instanceof HTMLElement) return el;
    }
    return null;
  };

  const onDragStart = (e: DragEvent) => {
    if (!(e.target instanceof Element)) return;
    if (!e.target.closest('.milkdown-block-handle')) return;

    proseMirror = findProseMirror();
    if (!proseMirror) return;

    const source = findSourceBlock(proseMirror);
    if (!source) return;

    const all = Array.from(proseMirror.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement,
    );
    sourceIndex = all.indexOf(source);
    if (sourceIndex < 0) return;

    siblings = all;
    rects = siblings.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    });
    sourceHeight = rects[sourceIndex].height + estimateGap(siblings, sourceIndex);

    siblings.forEach((el, i) => {
      el.style.transition = TRANSITION;
      if (i === sourceIndex) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
      }
    });

    active = true;
  };

  const onDragOver = (e: DragEvent) => {
    if (!active || sourceIndex < 0) return;

    const y = e.clientY;
    let target = siblings.length;
    for (let i = 0; i < siblings.length; i++) {
      if (i === sourceIndex) continue;
      const mid = rects[i].top + rects[i].height / 2;
      if (y < mid) {
        target = i;
        break;
      }
    }

    siblings.forEach((el, i) => {
      if (i === sourceIndex) return;
      let dy = 0;
      if (target > sourceIndex && i > sourceIndex && i < target) dy = -sourceHeight;
      else if (target <= sourceIndex && i >= target && i < sourceIndex) dy = sourceHeight;
      el.style.transform = dy ? `translate3d(0, ${dy}px, 0)` : '';
    });
  };

  const onEnd = () => {
    reset();
  };

  document.addEventListener('dragstart', onDragStart, true);
  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('dragend', onEnd, true);
  document.addEventListener('drop', onEnd, true);
  // Safety: if drag is cancelled with Esc or otherwise abandoned outside the doc.
  window.addEventListener('blur', onEnd);

  return () => {
    document.removeEventListener('dragstart', onDragStart, true);
    document.removeEventListener('dragover', onDragOver, true);
    document.removeEventListener('dragend', onEnd, true);
    document.removeEventListener('drop', onEnd, true);
    window.removeEventListener('blur', onEnd);
    reset();
  };
}

function estimateGap(blocks: HTMLElement[], i: number): number {
  // Use the visual gap between adjacent blocks as the "spacing budget" so
  // shifted blocks land in their natural slots.
  const next = blocks[i + 1];
  if (next) {
    const aBot = blocks[i].getBoundingClientRect().bottom;
    const bTop = next.getBoundingClientRect().top;
    return Math.max(0, bTop - aBot);
  }
  const prev = blocks[i - 1];
  if (prev) {
    const aBot = prev.getBoundingClientRect().bottom;
    const bTop = blocks[i].getBoundingClientRect().top;
    return Math.max(0, bTop - aBot);
  }
  return 0;
}
