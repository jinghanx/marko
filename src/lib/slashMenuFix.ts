/**
 * Crepe's slash menu keeps `hoverIndex` across show/hide cycles, so reopening
 * it after pressing ArrowDown previously starts with the wrong item highlighted.
 *
 * Workaround: when we detect the menu transitioning from hidden to shown,
 * dispatch enough synthetic ArrowUp events to clamp `hoverIndex` back to 0.
 * Crepe handles arrow keys via a `window` keydown listener with `capture: true`,
 * so synthetic dispatches are picked up the same as real ones, and Crepe's
 * `preventDefault` keeps the cursor in the editor from moving.
 */

let installed = false;
let observer: MutationObserver | null = null;
let lastShown = false;

function pumpArrowUps(times: number) {
  for (let i = 0; i < times; i++) {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        code: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

function check(menuEl: Element) {
  const isShown = menuEl.getAttribute('data-show') === 'true';
  if (isShown && !lastShown) {
    // Menu just appeared — reset cursor to first item.
    // Schedule on next tick so Crepe's own listeners are attached first.
    queueMicrotask(() => {
      pumpArrowUps(50);
    });
  }
  lastShown = isShown;
}

export function installSlashMenuFix() {
  if (installed) return;
  installed = true;

  const watchAll = () => {
    document.querySelectorAll<HTMLElement>('.milkdown-slash-menu').forEach((menu) => {
      check(menu);
    });
  };

  // Catch existing menus, plus any added by Crepe later.
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' && r.attributeName === 'data-show') {
        if (r.target instanceof Element) check(r.target);
      } else if (r.type === 'childList') {
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.matches?.('.milkdown-slash-menu')) check(n);
          n.querySelectorAll?.('.milkdown-slash-menu').forEach((m) => check(m));
        });
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-show'],
  });
  watchAll();
}
