import { useSyncExternalStore } from 'react';
import { applyEditorTheme, watchSystemTheme, type EditorTheme } from '../lib/editorTheme';

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
  contentFont: string;
  uiFont: string;
  codeFont: string;
  fontSize: number;
  maxContentWidth: number; // 0 = no cap
  vimMode: boolean;
  folderSort: FolderSort;
  showHiddenFiles: boolean;
  workspaceBookmarks: WorkspaceBookmark[];
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  editorTheme: 'frame',
  contentFont: `'New York', 'Iowan Old Style', 'PT Serif', Georgia, serif`,
  uiFont: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif`,
  codeFont: `'SF Mono', Menlo, Monaco, Consolas, monospace`,
  fontSize: 17,
  maxContentWidth: 0,
  vimMode: false,
  folderSort: { key: 'name', direction: 'asc', foldersFirst: true },
  showHiddenFiles: false,
  workspaceBookmarks: [],
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

function applyToDom(s: Settings) {
  const root = document.documentElement;
  if (s.theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', s.theme);
  }
  root.style.setProperty('--font-content', s.contentFont);
  root.style.setProperty('--font-ui', s.uiFont);
  root.style.setProperty('--font-mono', s.codeFont);
  root.style.setProperty('--editor-font-size', `${s.fontSize}px`);
  root.style.setProperty('--editor-max-width', s.maxContentWidth > 0 ? `${s.maxContentWidth}px` : 'none');
  applyEditorTheme(s.editorTheme, s.theme);
}

applyToDom(state);
watchSystemTheme(() => ({ appTheme: state.theme, editorTheme: state.editorTheme }));

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
