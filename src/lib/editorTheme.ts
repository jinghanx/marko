import frameLight from '@milkdown/crepe/theme/frame.css?url';
import frameDark from '@milkdown/crepe/theme/frame-dark.css?url';
import classicLight from '@milkdown/crepe/theme/classic.css?url';
import classicDark from '@milkdown/crepe/theme/classic-dark.css?url';
import nordLight from '@milkdown/crepe/theme/nord.css?url';
import nordDark from '@milkdown/crepe/theme/nord-dark.css?url';

export type EditorTheme = 'frame' | 'classic' | 'nord';

export const EDITOR_THEMES: { value: EditorTheme; label: string; description: string }[] = [
  { value: 'frame', label: 'Frame', description: 'Modern, minimal — the default' },
  { value: 'classic', label: 'Classic', description: 'Traditional, prose-forward' },
  { value: 'nord', label: 'Nord', description: 'Cool blue palette' },
];

const URLS: Record<EditorTheme, { light: string; dark: string }> = {
  frame: { light: frameLight, dark: frameDark },
  classic: { light: classicLight, dark: classicDark },
  nord: { light: nordLight, dark: nordDark },
};

const LINK_ID = 'marko-editor-theme';

function effectiveDark(appTheme: 'system' | 'light' | 'dark'): boolean {
  if (appTheme === 'dark') return true;
  if (appTheme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyEditorTheme(theme: EditorTheme, appTheme: 'system' | 'light' | 'dark') {
  const dark = effectiveDark(appTheme);
  const href = URLS[theme][dark ? 'dark' : 'light'];

  let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = LINK_ID;
    link.rel = 'stylesheet';
    // Prepend so our own overrides (loaded later via main.tsx) win.
    document.head.prepend(link);
  }
  if (link.href !== href) link.href = href;
}

let mediaListenerAttached = false;
export function watchSystemTheme(get: () => { appTheme: 'system' | 'light' | 'dark'; editorTheme: EditorTheme }) {
  if (mediaListenerAttached) return;
  mediaListenerAttached = true;
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', () => {
    const { appTheme, editorTheme } = get();
    if (appTheme === 'system') applyEditorTheme(editorTheme, appTheme);
  });
}
