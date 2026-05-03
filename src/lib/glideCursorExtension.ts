import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/**
 * Smooth-glide cursor for CodeMirror 6. The default `.cm-cursor`
 * elements are hidden via the bundled theme below; this view plugin
 * draws a single overlay div, anchored to the editor's contentDOM,
 * that lerps toward the main selection's head position each frame.
 *
 * Same easing model as the launcher input (`useGlideCaret`): rise
 * fast, settle in a few frames. Glides both horizontally and
 * vertically — line jumps slide instead of snapping. Identical
 * `glide-caret--idle` class contract so consumers' CSS controls the
 * resting blink rate.
 *
 * Multi-cursor: only the main selection's cursor is rendered. The
 * extension hides ALL `.cm-cursor` elements via theme, so secondary
 * cursors disappear; that's an acceptable trade for code editing
 * (multi-cursor is rare in practice for this app's audience and
 * users opting into it are typically watching a single primary
 * cursor anyway).
 */
const cursorPlugin = ViewPlugin.fromClass(
  class {
    cursor: HTMLDivElement;
    target = { x: 0, y: 0, h: 0 };
    current = { x: 0, y: 0, h: 0 };
    lastUpdateAt = 0;
    raf = 0;

    constructor(view: EditorView) {
      this.cursor = document.createElement('div');
      this.cursor.className = 'cm-glide-cursor';
      this.cursor.setAttribute('aria-hidden', 'true');
      view.contentDOM.appendChild(this.cursor);
      // Snap to the initial position so the cursor doesn't fly in from (0,0).
      this.computeTarget(view);
      this.current = { ...this.target };
      this.applyToDom();

      const tick = () => {
        const k = 0.35;
        this.current.x += (this.target.x - this.current.x) * k;
        this.current.y += (this.target.y - this.current.y) * k;
        this.current.h += (this.target.h - this.current.h) * k;
        this.applyToDom();
        // Suppress blink for ~600ms after the last cursor move so the
        // glide reads cleanly. Resume after that.
        const idle = Date.now() - this.lastUpdateAt > 600;
        this.cursor.classList.toggle('glide-caret--idle', idle);
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }

    /** Compute target pixel position relative to the contentDOM. */
    computeTarget(view: EditorView) {
      const pos = view.state.selection.main.head;
      const coords = view.coordsAtPos(pos);
      if (!coords) return;
      const cdr = view.contentDOM.getBoundingClientRect();
      this.target = {
        x: coords.left - cdr.left,
        y: coords.top - cdr.top,
        h: Math.max(1, coords.bottom - coords.top),
      };
    }

    applyToDom() {
      this.cursor.style.transform = `translate3d(${this.current.x}px, ${this.current.y}px, 0)`;
      this.cursor.style.height = `${this.current.h}px`;
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged) {
        this.computeTarget(update.view);
        if (update.docChanged || update.selectionSet) {
          this.lastUpdateAt = Date.now();
        }
      }
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      this.cursor.remove();
    }
  },
);

/** Theme that hides the default cursor so only our overlay shows. */
const cursorTheme = EditorView.theme({
  '.cm-cursor': { display: 'none' },
  '.cm-cursor-primary': { display: 'none' },
});

export const glideCursorExtension: Extension = [cursorPlugin, cursorTheme];
