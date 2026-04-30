import { useSyncExternalStore } from 'react';

export type TabKind = 'markdown' | 'code' | 'image' | 'binary' | 'folder' | 'web' | 'terminal';

export interface Tab {
  id: string;
  filePath: string | null;
  title: string;
  kind: TabKind;
  language?: string;
  ext?: string;
  content: string;
  savedContent: string;
  dirty: boolean;
}

// ---------- Pane tree ----------

export interface LeafNode {
  kind: 'leaf';
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

export interface SplitNode {
  kind: 'split';
  id: string;
  direction: 'horizontal' | 'vertical';
  ratio: number; // first child's share, 0..1
  children: [PaneTree, PaneTree];
}

export type PaneTree = LeafNode | SplitNode;

export interface FolderSelectionInfo {
  tabId: string;
  currentPath: string;
  selected: import('../types/marko').DirEntry[];
  totalCount: number;
  folderCount: number;
  fileCount: number;
}

interface WorkspaceState {
  tabs: Tab[];
  root: PaneTree;
  focusedLeafId: string;
  rootDir: string | null;
  sidebarVisible: boolean;
  outlineVisible: boolean;
  focusToken: number;
  revealPath: string | null;
  revealToken: number;
  folderSelection: FolderSelectionInfo | null;
}

let nextTabId = 1;
const newTabId = () => `tab-${nextTabId++}`;
let nextNodeId = 1;
const newNodeId = (kind: 'leaf' | 'split') => `${kind}-${nextNodeId++}`;

const listeners = new Set<() => void>();

const initialLeaf: LeafNode = {
  kind: 'leaf',
  id: newNodeId('leaf'),
  tabIds: [],
  activeTabId: null,
};

let state: WorkspaceState = {
  tabs: [],
  root: initialLeaf,
  focusedLeafId: initialLeaf.id,
  rootDir: null,
  sidebarVisible: true,
  outlineVisible: false,
  focusToken: 0,
  revealPath: null,
  revealToken: 0,
  folderSelection: null,
};

const setState = (next: Partial<WorkspaceState> | ((prev: WorkspaceState) => Partial<WorkspaceState>)) => {
  const patch = typeof next === 'function' ? next(state) : next;
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useWorkspace<T>(selector: (s: WorkspaceState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

// ---------- Tree helpers ----------

export function getAllLeaves(node: PaneTree): LeafNode[] {
  if (node.kind === 'leaf') return [node];
  return [...getAllLeaves(node.children[0]), ...getAllLeaves(node.children[1])];
}

export function findLeaf(node: PaneTree, id: string): LeafNode | null {
  if (node.kind === 'leaf') return node.id === id ? node : null;
  return findLeaf(node.children[0], id) ?? findLeaf(node.children[1], id);
}

function findLeafByTabId(node: PaneTree, tabId: string): LeafNode | null {
  if (node.kind === 'leaf') return node.tabIds.includes(tabId) ? node : null;
  return findLeafByTabId(node.children[0], tabId) ?? findLeafByTabId(node.children[1], tabId);
}

// Recursively map leaves; returns a new tree with the leaf transformed if matching.
function mapLeaf(node: PaneTree, id: string, fn: (leaf: LeafNode) => LeafNode): PaneTree {
  if (node.kind === 'leaf') return node.id === id ? fn(node) : node;
  const c0 = mapLeaf(node.children[0], id, fn);
  const c1 = mapLeaf(node.children[1], id, fn);
  if (c0 === node.children[0] && c1 === node.children[1]) return node;
  return { ...node, children: [c0, c1] };
}

// Map every leaf.
function mapAllLeaves(node: PaneTree, fn: (leaf: LeafNode) => LeafNode): PaneTree {
  if (node.kind === 'leaf') return fn(node);
  const c0 = mapAllLeaves(node.children[0], fn);
  const c1 = mapAllLeaves(node.children[1], fn);
  return { ...node, children: [c0, c1] };
}

// Replace a node anywhere in the tree.
function replaceNode(node: PaneTree, target: PaneTree, replacement: PaneTree): PaneTree {
  if (node === target) return replacement;
  if (node.kind === 'leaf') return node;
  const c0 = replaceNode(node.children[0], target, replacement);
  const c1 = replaceNode(node.children[1], target, replacement);
  return c0 === node.children[0] && c1 === node.children[1]
    ? node
    : { ...node, children: [c0, c1] };
}

// Find parent of a node by id (returns parent split + which child index).
function findParent(
  node: PaneTree,
  childId: string,
  parent: SplitNode | null = null,
): { parent: SplitNode; index: 0 | 1 } | null {
  if (node.kind === 'leaf') {
    return parent && (node.id === childId)
      ? { parent, index: parent.children[0] === node ? 0 : 1 }
      : null;
  }
  if (node.id === childId && parent) {
    return { parent, index: parent.children[0] === node ? 0 : 1 };
  }
  const a = findParent(node.children[0], childId, node);
  if (a) return a;
  return findParent(node.children[1], childId, node);
}

function setSplitRatio(node: PaneTree, splitId: string, ratio: number): PaneTree {
  if (node.kind === 'leaf') return node;
  if (node.id === splitId) return { ...node, ratio: Math.max(0.1, Math.min(0.9, ratio)) };
  const c0 = setSplitRatio(node.children[0], splitId, ratio);
  const c1 = setSplitRatio(node.children[1], splitId, ratio);
  return c0 === node.children[0] && c1 === node.children[1] ? node : { ...node, children: [c0, c1] };
}

// Garbage-collect tabs that are not referenced by any leaf.
function gcTabs(s: WorkspaceState): Tab[] {
  const referenced = new Set<string>();
  for (const leaf of getAllLeaves(s.root)) for (const id of leaf.tabIds) referenced.add(id);
  return s.tabs.filter((t) => referenced.has(t.id));
}

/** If the focused pane's active tab is a real-fs file/folder under the
 *  current workspace root, request a reveal in the sidebar. */
function revealActiveTabInTree() {
  const focused = findLeaf(state.root, state.focusedLeafId);
  if (!focused?.activeTabId) return;
  const tab = state.tabs.find((t) => t.id === focused.activeTabId);
  if (!tab || !tab.filePath || tab.kind === 'web' || tab.kind === 'terminal') return;
  const root = state.rootDir;
  if (!root) return;
  if (tab.filePath !== root && !tab.filePath.startsWith(root + '/')) return;
  // Set revealPath/Token directly to avoid recursive method invocation.
  setState((prev) => ({
    revealPath: tab.filePath,
    revealToken: prev.revealToken + 1,
  }));
}

// ---------- Workspace API ----------

export const workspace = {
  getState: () => state,
  setState,

  getFocusedLeaf(): LeafNode {
    return findLeaf(state.root, state.focusedLeafId) ?? getAllLeaves(state.root)[0];
  },

  getActiveTab(): Tab | null {
    const leaf = workspace.getFocusedLeaf();
    if (!leaf.activeTabId) return null;
    return state.tabs.find((t) => t.id === leaf.activeTabId) ?? null;
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
      root: mapLeaf(prev.root, prev.focusedLeafId, (l) => ({
        ...l,
        tabIds: [...l.tabIds, tab.id],
        activeTabId: tab.id,
      })),
    }));
    return tab;
  },

  openFileTab(filePath: string, content: string, title: string, kind: TabKind = 'markdown'): Tab {
    const existing = state.tabs.find((t) => t.filePath === filePath);
    if (existing) {
      setState((prev) => ({
        root: mapLeaf(prev.root, prev.focusedLeafId, (l) => ({
          ...l,
          tabIds: l.tabIds.includes(existing.id) ? l.tabIds : [...l.tabIds, existing.id],
          activeTabId: existing.id,
        })),
      }));
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
      root: mapLeaf(prev.root, prev.focusedLeafId, (l) => ({
        ...l,
        tabIds: [...l.tabIds, tab.id],
        activeTabId: tab.id,
      })),
    }));
    return tab;
  },

  setActiveTab(id: string) {
    setState((prev) => {
      const leaf = findLeafByTabId(prev.root, id);
      if (!leaf) return prev;
      const root = mapLeaf(prev.root, leaf.id, (l) => ({ ...l, activeTabId: id }));
      return { root, focusedLeafId: leaf.id, focusToken: prev.focusToken + 1 };
    });
    revealActiveTabInTree();
  },

  setFocusedPane(leafId: string) {
    setState((prev) =>
      findLeaf(prev.root, leafId)
        ? { focusedLeafId: leafId, focusToken: prev.focusToken + 1 }
        : prev,
    );
    revealActiveTabInTree();
  },

  cycleTab(delta: number) {
    setState((prev) => {
      const leaf = findLeaf(prev.root, prev.focusedLeafId);
      if (!leaf || leaf.tabIds.length === 0) return prev;
      const idx = leaf.tabIds.indexOf(leaf.activeTabId ?? '');
      const len = leaf.tabIds.length;
      const next = idx < 0 ? 0 : (idx + delta + len) % len;
      return {
        root: mapLeaf(prev.root, leaf.id, (l) => ({ ...l, activeTabId: l.tabIds[next] })),
        focusToken: prev.focusToken + 1,
      };
    });
    revealActiveTabInTree();
  },

  /** Close a tab from a specific pane (leaf). Other panes that have the same
   *  tab id keep showing it. */
  closeTabInLeaf(leafId: string, id: string) {
    setState((prev) => {
      const leaf = findLeaf(prev.root, leafId);
      if (!leaf || !leaf.tabIds.includes(id)) return prev;
      const idx = leaf.tabIds.indexOf(id);
      const tabIds = leaf.tabIds.filter((t) => t !== id);
      let activeTabId = leaf.activeTabId;
      if (activeTabId === id) activeTabId = tabIds[idx] ?? tabIds[idx - 1] ?? null;

      let root = mapLeaf(prev.root, leaf.id, (l) => ({ ...l, tabIds, activeTabId }));
      let focusedLeafId = prev.focusedLeafId;

      // Collapse this leaf if empty and it has a parent (i.e., not the only pane).
      if (tabIds.length === 0) {
        const parentInfo = findParent(root, leaf.id);
        if (parentInfo) {
          const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
          root = replaceNode(root, parentInfo.parent, sibling);
          if (focusedLeafId === leaf.id) focusedLeafId = getAllLeaves(sibling)[0].id;
        }
      }

      const tabs = gcTabs({ ...prev, root, tabs: prev.tabs });
      return { root, tabs, focusedLeafId };
    });
  },

  /** Close from the focused pane. */
  closeTab(id: string) {
    workspace.closeTabInLeaf(state.focusedLeafId, id);
  },

  /** Close multiple tabs from a specific pane. */
  closeTabsInLeaf(leafId: string, ids: string[]) {
    if (ids.length === 0) return;
    const closeSet = new Set(ids);
    setState((prev) => {
      const leaf = findLeaf(prev.root, leafId);
      if (!leaf) return prev;
      const tabIds = leaf.tabIds.filter((t) => !closeSet.has(t));
      let activeTabId = leaf.activeTabId;
      if (activeTabId && closeSet.has(activeTabId)) activeTabId = tabIds[0] ?? null;

      let root = mapLeaf(prev.root, leaf.id, (l) => ({ ...l, tabIds, activeTabId }));
      let focusedLeafId = prev.focusedLeafId;

      if (tabIds.length === 0) {
        const parentInfo = findParent(root, leaf.id);
        if (parentInfo) {
          const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
          root = replaceNode(root, parentInfo.parent, sibling);
          if (focusedLeafId === leaf.id) focusedLeafId = getAllLeaves(sibling)[0].id;
        }
      }

      const tabs = gcTabs({ ...prev, root, tabs: prev.tabs });
      return { root, tabs, focusedLeafId };
    });
  },

  closeTabs(ids: string[]) {
    workspace.closeTabsInLeaf(state.focusedLeafId, ids);
  },

  // ---------- Splitting ----------

  splitFocused(direction: 'horizontal' | 'vertical') {
    setState((prev) => {
      const leaf = findLeaf(prev.root, prev.focusedLeafId);
      if (!leaf) return prev;
      const cloneTabId = leaf.activeTabId;
      const newLeaf: LeafNode = {
        kind: 'leaf',
        id: newNodeId('leaf'),
        tabIds: cloneTabId ? [cloneTabId] : [],
        activeTabId: cloneTabId,
      };
      const split: SplitNode = {
        kind: 'split',
        id: newNodeId('split'),
        direction,
        ratio: 0.5,
        children: [leaf, newLeaf],
      };
      const root = replaceNode(prev.root, leaf, split);
      return { root, focusedLeafId: newLeaf.id };
    });
  },

  closePane(leafId: string) {
    setState((prev) => {
      const leaf = findLeaf(prev.root, leafId);
      if (!leaf) return prev;
      const parentInfo = findParent(prev.root, leafId);
      if (!parentInfo) return prev; // last pane — refuse
      const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
      const root = replaceNode(prev.root, parentInfo.parent, sibling);
      const focusedLeafId =
        prev.focusedLeafId === leafId ? getAllLeaves(sibling)[0].id : prev.focusedLeafId;
      const tabs = gcTabs({ ...prev, root, tabs: prev.tabs });
      return { root, tabs, focusedLeafId };
    });
  },

  setSplitRatio(splitId: string, ratio: number) {
    setState((prev) => ({ root: setSplitRatio(prev.root, splitId, ratio) }));
  },

  // ---------- Tab content ----------

  updateContent(id: string, content: string) {
    setState((prev) => ({
      tabs: prev.tabs.map((t) =>
        t.id === id ? { ...t, content, dirty: content !== t.savedContent } : t,
      ),
    }));
  },

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

  // ---------- Workspace UI ----------

  setRootDir(dir: string | null) {
    setState({ rootDir: dir });
    // Remember it so we can restore on next launch.
    try {
      if (dir) localStorage.setItem('marko:lastWorkspace', dir);
      else localStorage.removeItem('marko:lastWorkspace');
    } catch {
      // localStorage may be unavailable in unusual contexts
    }
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

  /** Ask the sidebar to expand ancestors and select this path. */
  revealInTree(path: string) {
    setState((prev) => ({ revealPath: path, revealToken: prev.revealToken + 1 }));
  },

  setFolderSelection(info: FolderSelectionInfo | null) {
    setState({ folderSelection: info });
  },
};
