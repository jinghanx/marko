import { useSyncExternalStore } from 'react';

export type TabKind = 'markdown' | 'code' | 'image' | 'binary' | 'folder' | 'web';

export interface Tab {
  id: string;
  filePath: string | null;
  title: string;
  kind: TabKind;
  /** CodeMirror language name (e.g. 'python', 'json') for new code tabs without a filePath. */
  language?: string;
  /** Suggested extension for Save As when this tab has no filePath yet. */
  ext?: string;
  content: string;
  savedContent: string;
  dirty: boolean;
}

interface WorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  rootDir: string | null;
  sidebarVisible: boolean;
  outlineVisible: boolean;
  focusToken: number;
}

let nextTabId = 1;
const newTabId = () => `tab-${nextTabId++}`;

const listeners = new Set<() => void>();

let state: WorkspaceState = {
  tabs: [],
  activeTabId: null,
  rootDir: null,
  sidebarVisible: true,
  outlineVisible: false,
  focusToken: 0,
};

const setState = (next: Partial<WorkspaceState> | ((prev: WorkspaceState) => Partial<WorkspaceState>)) => {
  const patch = typeof next === 'function' ? next(state) : next;
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function useWorkspace<T>(selector: (s: WorkspaceState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

export const workspace = {
  getState: () => state,
  setState,

  getActiveTab(): Tab | null {
    return state.tabs.find((t) => t.id === state.activeTabId) ?? null;
  },

  openNewTab(opts: { kind?: TabKind; language?: string; ext?: string; title?: string } = {}): Tab {
    const tab: Tab = {
      id: newTabId(),
      filePath: null,
      title: opts.title ?? 'Untitled',
      kind: opts.kind ?? 'markdown',
      language: opts.language,
      ext: opts.ext,
      content: '',
      savedContent: '',
      dirty: false,
    };
    setState((prev) => ({
      tabs: [...prev.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab;
  },

  openFileTab(filePath: string, content: string, title: string, kind: TabKind = 'markdown'): Tab {
    const existing = state.tabs.find((t) => t.filePath === filePath);
    if (existing) {
      setState({ activeTabId: existing.id });
      return existing;
    }
    const tab: Tab = {
      id: newTabId(),
      filePath,
      title,
      kind,
      content,
      savedContent: content,
      dirty: false,
    };
    setState((prev) => ({
      tabs: [...prev.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab;
  },

  setActiveTab(id: string) {
    setState({ activeTabId: id });
  },

  cycleTab(delta: number) {
    if (state.tabs.length === 0) return;
    const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
    const len = state.tabs.length;
    const next = idx < 0 ? 0 : (idx + delta + len) % len;
    setState({ activeTabId: state.tabs[next].id });
  },

  closeTab(id: string) {
    setState((prev) => {
      const idx = prev.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const tabs = prev.tabs.filter((t) => t.id !== id);
      let activeTabId = prev.activeTabId;
      if (activeTabId === id) {
        const next = tabs[idx] ?? tabs[idx - 1] ?? null;
        activeTabId = next?.id ?? null;
      }
      return { tabs, activeTabId };
    });
  },

  closeTabs(ids: string[]) {
    if (ids.length === 0) return;
    const set = new Set(ids);
    setState((prev) => {
      const tabs = prev.tabs.filter((t) => !set.has(t.id));
      let activeTabId = prev.activeTabId;
      if (activeTabId && set.has(activeTabId)) {
        activeTabId = tabs[0]?.id ?? null;
      }
      return { tabs, activeTabId };
    });
  },

  updateContent(id: string, content: string) {
    setState((prev) => ({
      tabs: prev.tabs.map((t) =>
        t.id === id ? { ...t, content, dirty: content !== t.savedContent } : t,
      ),
    }));
  },

  /** Adopt the editor's first-parse output as the saved baseline so the tab
   *  doesn't become dirty just from markdown round-tripping. */
  rebaseSavedContent(id: string, content: string) {
    setState((prev) => ({
      tabs: prev.tabs.map((t) =>
        t.id === id ? { ...t, content, savedContent: content, dirty: false } : t,
      ),
    }));
  },

  markSaved(id: string, filePath: string, title: string) {
    setState((prev) => ({
      tabs: prev.tabs.map((t) =>
        t.id === id ? { ...t, filePath, title, savedContent: t.content, dirty: false } : t,
      ),
    }));
  },

  setRootDir(dir: string | null) {
    setState({ rootDir: dir });
  },

  toggleSidebar() {
    setState((prev) => ({ sidebarVisible: !prev.sidebarVisible }));
  },

  toggleOutline() {
    setState((prev) => ({ outlineVisible: !prev.outlineVisible }));
  },

  requestEditorFocus() {
    setState((prev) => ({ focusToken: prev.focusToken + 1 }));
  },
};
