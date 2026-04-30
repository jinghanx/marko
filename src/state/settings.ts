import { useSyncExternalStore } from 'react';
import { applyEditorTheme, watchSystemTheme, type EditorTheme } from '../lib/editorTheme';
import { applyThemeToDom, getTheme, DEFAULT_LIGHT_ID, DEFAULT_DARK_ID } from '../lib/themes';

export type ThemeMode = 'system' | 'light' | 'dark';

export type FolderSortKey = 'name' | 'modified' | 'created' | 'size' | 'type';
export type SortDirection = 'asc' | 'desc';

export interface FolderSort {
  key: FolderSortKey;
  direction: SortDirection;
  foldersFirst: boolean;
}

export interface WorkspaceBookmark {
  name: string;
  path: string;
}

export interface Settings {
  theme: ThemeMode;
  editorTheme: EditorTheme;
  /** Color theme id used when the app is in light mode. */
  lightThemeId: string;
  /** Color theme id used when the app is in dark mode. */
  darkThemeId: string;
  contentFont: string;
  uiFont: string;
  codeFont: string;
  fontSize: number;
  maxContentWidth: number; // 0 = no cap
  vimMode: boolean;
  folderSort: FolderSort;
  /** Icon size for the finder/folder grid, in px (square). */
  folderIconSize: number;
  showHiddenFiles: boolean;
  workspaceBookmarks: WorkspaceBookmark[];
  /** Most-recently-opened file paths, newest first. Capped at MAX_RECENT_FILES. */
  recentFiles: string[];
}

export const MAX_RECENT_FILES = 30;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  editorTheme: 'frame',
  lightThemeId: DEFAULT_LIGHT_ID,
  darkThemeId: DEFAULT_DARK_ID,
  contentFont: `'New York', 'Iowan Old Style', 'PT Serif', Georgia, serif`,
  uiFont: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif`,
  codeFont: `'SF Mono', Menlo, Monaco, Consolas, monospace`,
  fontSize: 17,
  maxContentWidth: 0,
  vimMode: false,
  folderSort: { key: 'name', direction: 'asc', foldersFirst: true },
  folderIconSize: 72,
  showHiddenFiles: false,
  workspaceBookmarks: [],
  recentFiles: [],
};

const STORAGE_KEY = 'marko:settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persist(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota / unavailable
  }
}

let state: Settings = load();
const listeners = new Set<() => void>();

function effectiveDark(theme: ThemeMode): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function activeTheme(s: Settings) {
  const dark = effectiveDark(s.theme);
  const id = dark ? s.darkThemeId : s.lightThemeId;
  return getTheme(id) ?? getTheme(dark ? DEFAULT_DARK_ID : DEFAULT_LIGHT_ID)!;
}

function applyToDom(s: Settings) {
  const root = document.documentElement;
  if (s.theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', s.theme);
  }
  // Apply the picked color theme — overrides default light/dark CSS vars.
  applyThemeToDom(activeTheme(s));
  root.style.setProperty('--font-content', s.contentFont);
  root.style.setProperty('--font-ui', s.uiFont);
  root.style.setProperty('--font-mono', s.codeFont);
  root.style.setProperty('--editor-font-size', `${s.fontSize}px`);
  root.style.setProperty('--editor-max-width', s.maxContentWidth > 0 ? `${s.maxContentWidth}px` : 'none');
  root.style.setProperty('--folder-icon-size', `${s.folderIconSize}px`);
  applyEditorTheme(s.editorTheme, s.theme);
}

applyToDom(state);
watchSystemTheme(() => ({ appTheme: state.theme, editorTheme: state.editorTheme }));

// Re-apply when system color scheme flips (so the right light/dark theme kicks in).
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.theme === 'system') applyToDom(state);
});

export const settings = {
  get(): Settings {
    return state;
  },

  update(patch: Partial<Settings>) {
    state = { ...state, ...patch };
    persist(state);
    applyToDom(state);
    listeners.forEach((fn) => fn());
  },

  reset() {
    state = DEFAULT_SETTINGS;
    persist(state);
    applyToDom(state);
    listeners.forEach((fn) => fn());
  },

  /** Move `filePath` to the front of recentFiles (deduped, capped). */
  pushRecentFile(filePath: string) {
    if (!filePath) return;
    const next = [filePath, ...state.recentFiles.filter((p) => p !== filePath)].slice(
      0,
      MAX_RECENT_FILES,
    );
    state = { ...state, recentFiles: next };
    persist(state);
    listeners.forEach((fn) => fn());
  },

  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function useSettings(): Settings {
  return useSyncExternalStore(
    settings.subscribe,
    () => state,
    () => state,
  );
}

/** Returns the currently-active theme (resolved against light/dark mode). */
export function useActiveTheme() {
  const s = useSettings();
  return activeTheme(s);
}
