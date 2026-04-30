import { Vim } from '@replit/codemirror-vim';

let installed = false;

/**
 * Replace the upstream `<C-d>` / `<C-u>` motions with a clamped half-page scroll.
 * Avoids a bug where the upstream `moveByScroll` wraps to line 0 when scrolling
 * past the bottom of the document.
 */
export function installVimOverrides() {
  if (installed) return;
  installed = true;

  const halfPage = (cm: any, forward: boolean) => {
    const info = cm.getScrollInfo();
    const lineHeight = cm.defaultTextHeight();
    const half = Math.max(1, Math.floor(info.clientHeight / lineHeight / 2));
    const cur = cm.getCursor();
    const lastLine = cm.lineCount() - 1;
    const newLine = forward
      ? Math.min(lastLine, cur.line + half)
      : Math.max(0, cur.line - half);
    if (newLine === cur.line) return;
    cm.setCursor({ line: newLine, ch: cur.ch });
    cm.scrollIntoView({ line: newLine, ch: cur.ch });
  };

  Vim.defineAction('markoHalfPageDown', (cm: any) => halfPage(cm, true));
  Vim.defineAction('markoHalfPageUp', (cm: any) => halfPage(cm, false));

  for (const ctx of ['normal', 'visual']) {
    Vim.mapCommand('<C-d>', 'action', 'markoHalfPageDown', {}, { context: ctx });
    Vim.mapCommand('<C-u>', 'action', 'markoHalfPageUp', {}, { context: ctx });
  }
}
