import { useSyncExternalStore } from 'react';

export type TabKind =
  | 'markdown'
  | 'code'
  | 'image'
  | 'media'
  | 'pdf'
  | 'csv'
  | 'json'
  | 'diff'
  | 'binary'
  | 'folder'
  | 'web'
  | 'terminal'
  | 'process'
  | 'git'
  | 'excalidraw'
  | 'chat'
  | 'search'
  | 'http'
  | 'clipboard'
  | 'settings'
  | 'sqlite'
  | 'shortcuts';

export interface Tab {
  id: string;
  filePath: string | null;
  title: string;
  kind: TabKind;
  language?: string;
  ext?: string;
  /** Markdown / JSON tabs: which alternate view mode is showing.
   *   - markdown: 'rendered' (Crepe), 'raw' (CodeMirror), 'split'
   *   - json: 'tree' (collapsible inspector), 'raw' (CodeMirror), 'split'
   */
  viewMode?: 'rendered' | 'raw' | 'split' | 'tree';
  /** Diff tabs only — paths to the left/right files to compare. */
  diffLeft?: string;
  diffRight?: string;
  content: string;
  savedContent: string;
  dirty: boolean;
  /** Pinned tabs sort to the front of every leaf they're in (Chrome-style)
   *  and survive "Close Other Tabs" / "Close Tabs to the Right". */
  pinned?: boolean;
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

/** A "session" is an independent workspace within the same window — its own
 *  pane tree, its own focused pane, its own remembered active tab per pane.
 *  Tabs themselves live in the global `tabs` array and can be referenced by
 *  any session's leaves (so opening the same file in two sessions shares
 *  one buffer). */
export interface Session {
  id: string;
  name: string;
  root: PaneTree;
  focusedLeafId: string;
  /** Per-session workspace root directory. Each session is an independent
   *  task context with its own sidebar / file palette / fuzzy search scope. */
  rootDir: string | null;
  /** Per-session sidebar visibility — each workspace can decide whether
   *  the file tree is showing. Defaults to true for new sessions. */
  sidebarVisible: boolean;
  /** Per-session outline visibility — same model as sidebarVisible. */
  outlineVisible: boolean;
}

interface WorkspaceState {
  tabs: Tab[];
  sessions: Session[];
  activeSessionId: string;
  focusToken: number;
  revealPath: string | null;
  revealToken: number;
  folderSelection: FolderSelectionInfo | null;
  /** Active layout-cycle session — saved original tree + current step index. */
  layoutCycle: { originalRoot: PaneTree; index: number } | null;
  /** Tab IDs currently playing audio or video. The title-bar "now playing"
   *  button reads this; tabs report their own state via `setTabPlaying`. */
  playingTabIds: string[];
}

let nextTabId = 1;
const newTabId = () => `tab-${nextTabId++}`;
let nextNodeId = 1;
const newNodeId = (kind: 'leaf' | 'split') => `${kind}-${nextNodeId++}`;
let nextSessionId = 1;
const newSessionId = () => `session-${nextSessionId++}`;

const listeners = new Set<() => void>();

function makeFreshSession(name = 'Workspace', rootDir: string | null = null): Session {
  const leaf: LeafNode = {
    kind: 'leaf',
    id: newNodeId('leaf'),
    tabIds: [],
    activeTabId: null,
  };
  return {
    id: newSessionId(),
    name,
    root: leaf,
    focusedLeafId: leaf.id,
    rootDir,
    sidebarVisible: true,
    outlineVisible: false,
  };
}

const initialSession = makeFreshSession();

let state: WorkspaceState = {
  tabs: [],
  sessions: [initialSession],
  activeSessionId: initialSession.id,
  focusToken: 0,
  revealPath: null,
  revealToken: 0,
  folderSelection: null,
  layoutCycle: null,
  playingTabIds: [],
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

export const subscribeWorkspace = subscribe;

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

// ---------- Layout cycling ----------

function sameLeafSet(a: LeafNode[], b: LeafNode[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((l) => l.id));
  return b.every((l) => ids.has(l.id));
}

function hsplit(left: PaneTree, right: PaneTree, ratio = 0.5): SplitNode {
  return {
    kind: 'split',
    id: newNodeId('split'),
    direction: 'horizontal',
    ratio,
    children: [left, right],
  };
}

function vsplit(top: PaneTree, bottom: PaneTree, ratio = 0.5): SplitNode {
  return {
    kind: 'split',
    id: newNodeId('split'),
    direction: 'vertical',
    ratio,
    children: [top, bottom],
  };
}

// Right-leaning chain of N leaves with equal-width slots: each split's ratio
// is 1 / (count of leaves still to its right + 1) so every leaf ends up at
// 1/N of the container width.
function chainHorizontal(leaves: LeafNode[]): PaneTree {
  const n = leaves.length;
  if (n === 1) return leaves[0];
  return hsplit(leaves[0], chainHorizontal(leaves.slice(1)), 1 / n);
}
function chainVertical(leaves: LeafNode[]): PaneTree {
  const n = leaves.length;
  if (n === 1) return leaves[0];
  return vsplit(leaves[0], chainVertical(leaves.slice(1)), 1 / n);
}

// Generate a curated set of layouts for the given leaves. Returned trees use
// the original LeafNode objects, so tab content is preserved exactly.
function generateLayouts(leaves: LeafNode[]): PaneTree[] {
  const n = leaves.length;
  if (n < 2) return [];

  if (n === 2) {
    return [
      hsplit(leaves[0], leaves[1]), // side-by-side
      vsplit(leaves[0], leaves[1]), // stacked
    ];
  }

  // For "1 + (N-1)" layouts (main + stacked, top + columns), the outer split
  // ratio must be 1/N so each leaf ends up with equal area.
  const outer = 1 / n;

  if (n === 3) {
    return [
      // 3 columns — each 1/3
      chainHorizontal(leaves),
      // main on left, two stacked on right — each 1/3
      hsplit(leaves[0], chainVertical(leaves.slice(1)), outer),
      // top row, two columns below — each 1/3
      vsplit(leaves[0], chainHorizontal(leaves.slice(1)), outer),
      // 3 rows — each 1/3
      chainVertical(leaves),
    ];
  }

  if (n === 4) {
    return [
      // 2x2 grid — each 1/4
      hsplit(vsplit(leaves[0], leaves[1]), vsplit(leaves[2], leaves[3])),
      // 4 columns — each 1/4
      chainHorizontal(leaves),
      // main + 3 stacked — each 1/4
      hsplit(leaves[0], chainVertical(leaves.slice(1)), outer),
      // top row + 3 columns below — each 1/4
      vsplit(leaves[0], chainHorizontal(leaves.slice(1)), outer),
      // 4 rows — each 1/4
      chainVertical(leaves),
    ];
  }

  // 5+: compact set with even sizes.
  return [
    chainHorizontal(leaves),
    hsplit(leaves[0], chainVertical(leaves.slice(1)), outer),
    vsplit(leaves[0], chainHorizontal(leaves.slice(1)), outer),
    chainVertical(leaves),
  ];
}

// ---------- Session helpers ----------

/** Get the currently-active session (always exists — initialized in state). */
export function getActiveSession(s?: WorkspaceState): Session {
  const st = s ?? state;
  return st.sessions.find((x) => x.id === st.activeSessionId) ?? st.sessions[0];
}

/** Update the active session with a partial patch. Returns a new sessions array. */
function patchActiveSession(prev: WorkspaceState, patch: Partial<Session>): Session[] {
  return prev.sessions.map((s) =>
    s.id === prev.activeSessionId ? { ...s, ...patch } : s,
  );
}

/** Update a specific session by id. */
function patchSession(
  prev: WorkspaceState,
  sessionId: string,
  patch: Partial<Session>,
): Session[] {
  return prev.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s));
}

// Garbage-collect tabs that are not referenced by any session's leaves.
function gcTabs(s: WorkspaceState): Tab[] {
  const referenced = new Set<string>();
  for (const session of s.sessions) {
    for (const leaf of getAllLeaves(session.root)) {
      for (const id of leaf.tabIds) referenced.add(id);
    }
  }
  return s.tabs.filter((t) => referenced.has(t.id));
}

/** If the focused pane's active tab in the active session is a real-fs
 *  file/folder under the active session's root, request a reveal in the sidebar. */
function revealActiveTabInTree() {
  const session = getActiveSession();
  const focused = findLeaf(session.root, session.focusedLeafId);
  if (!focused?.activeTabId) return;
  const tab = state.tabs.find((t) => t.id === focused.activeTabId);
  if (!tab || !tab.filePath || tab.kind === 'web' || tab.kind === 'terminal') return;
  const root = session.rootDir;
  if (!root) return;
  if (tab.filePath !== root && !tab.filePath.startsWith(root + '/')) return;
  setState((prev) => ({
    revealPath: tab.filePath,
    revealToken: prev.revealToken + 1,
  }));
}

// ---------- Workspace API ----------

export const workspace = {
  getState: () => state,
  setState,

  getActiveSession,

  getFocusedLeaf(): LeafNode {
    const s = getActiveSession();
    return findLeaf(s.root, s.focusedLeafId) ?? getAllLeaves(s.root)[0];
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
    setState((prev) => {
      const active = getActiveSession(prev);
      return {
        tabs: [...prev.tabs, tab],
        sessions: patchActiveSession(prev, {
          root: mapLeaf(active.root, active.focusedLeafId, (l) => ({
            ...l,
            tabIds: [...l.tabIds, tab.id],
            activeTabId: tab.id,
          })),
        }),
      };
    });
    return tab;
  },

  openFileTab(filePath: string, content: string, title: string, kind: TabKind = 'markdown'): Tab {
    const existing = state.tabs.find((t) => t.filePath === filePath);
    if (existing) {
      setState((prev) => {
        const active = getActiveSession(prev);
        return {
          sessions: patchActiveSession(prev, {
            root: mapLeaf(active.root, active.focusedLeafId, (l) => ({
              ...l,
              tabIds: l.tabIds.includes(existing.id) ? l.tabIds : [...l.tabIds, existing.id],
              activeTabId: existing.id,
            })),
          }),
        };
      });
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
    setState((prev) => {
      const active = getActiveSession(prev);
      return {
        tabs: [...prev.tabs, tab],
        sessions: patchActiveSession(prev, {
          root: mapLeaf(active.root, active.focusedLeafId, (l) => ({
            ...l,
            tabIds: [...l.tabIds, tab.id],
            activeTabId: tab.id,
          })),
        }),
      };
    });
    return tab;
  },

  setActiveTab(id: string) {
    setState((prev) => {
      const active = getActiveSession(prev);
      const leaf = findLeafByTabId(active.root, id);
      if (!leaf) return prev;
      return {
        sessions: patchActiveSession(prev, {
          root: mapLeaf(active.root, leaf.id, (l) => ({ ...l, activeTabId: id })),
          focusedLeafId: leaf.id,
        }),
        focusToken: prev.focusToken + 1,
      };
    });
    revealActiveTabInTree();
  },

  /** Toggle pin on a tab. Pinned tabs sort to the front of every leaf they
   *  appear in (Chrome-style); the pin state is per-tab, not per-leaf. */
  togglePinTab(id: string) {
    setState((prev) => {
      const target = prev.tabs.find((t) => t.id === id);
      if (!target) return prev;
      const nextPinned = !target.pinned;
      const tabs = prev.tabs.map((t) => (t.id === id ? { ...t, pinned: nextPinned } : t));
      // Re-sort tabIds in every leaf that contains this tab so pinned tabs
      // come first (preserving relative order within each group).
      const pinnedById = new Map<string, boolean>();
      for (const t of tabs) pinnedById.set(t.id, !!t.pinned);
      const sortLeafTabs = (l: LeafNode): LeafNode => {
        if (!l.tabIds.includes(id)) return l;
        const pinned = l.tabIds.filter((tid) => pinnedById.get(tid));
        const rest = l.tabIds.filter((tid) => !pinnedById.get(tid));
        return { ...l, tabIds: [...pinned, ...rest] };
      };
      const visit = (n: PaneTree): PaneTree => {
        if (n.kind === 'leaf') return sortLeafTabs(n);
        return { ...n, children: [visit(n.children[0]), visit(n.children[1])] };
      };
      const sessions = prev.sessions.map((s) => ({ ...s, root: visit(s.root) }));
      return { tabs, sessions };
    });
  },

  setFocusedPane(leafId: string) {
    setState((prev) => {
      const active = getActiveSession(prev);
      if (!findLeaf(active.root, leafId)) return prev;
      return {
        sessions: patchActiveSession(prev, { focusedLeafId: leafId }),
        focusToken: prev.focusToken + 1,
      };
    });
    revealActiveTabInTree();
  },

  cycleTab(delta: number) {
    setState((prev) => {
      const active = getActiveSession(prev);
      const leaf = findLeaf(active.root, active.focusedLeafId);
      if (!leaf || leaf.tabIds.length === 0) return prev;
      const idx = leaf.tabIds.indexOf(leaf.activeTabId ?? '');
      const len = leaf.tabIds.length;
      const next = idx < 0 ? 0 : (idx + delta + len) % len;
      return {
        sessions: patchActiveSession(prev, {
          root: mapLeaf(active.root, leaf.id, (l) => ({ ...l, activeTabId: l.tabIds[next] })),
        }),
        focusToken: prev.focusToken + 1,
      };
    });
    revealActiveTabInTree();
  },

  /** Close a tab from a specific pane (leaf) within the active session. */
  closeTabInLeaf(leafId: string, id: string) {
    setState((prev) => {
      const active = getActiveSession(prev);
      const leaf = findLeaf(active.root, leafId);
      if (!leaf || !leaf.tabIds.includes(id)) return prev;
      const idx = leaf.tabIds.indexOf(id);
      const tabIds = leaf.tabIds.filter((t) => t !== id);
      let activeTabId = leaf.activeTabId;
      if (activeTabId === id) activeTabId = tabIds[idx] ?? tabIds[idx - 1] ?? null;

      let root = mapLeaf(active.root, leaf.id, (l) => ({ ...l, tabIds, activeTabId }));
      let focusedLeafId = active.focusedLeafId;

      if (tabIds.length === 0) {
        const parentInfo = findParent(root, leaf.id);
        if (parentInfo) {
          const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
          root = replaceNode(root, parentInfo.parent, sibling);
          if (focusedLeafId === leaf.id) focusedLeafId = getAllLeaves(sibling)[0].id;
        }
      }

      const sessions = patchActiveSession(prev, { root, focusedLeafId });
      const tabs = gcTabs({ ...prev, sessions });
      return { sessions, tabs };
    });
  },

  /** Close from the focused pane. */
  closeTab(id: string) {
    workspace.closeTabInLeaf(getActiveSession().focusedLeafId, id);
  },

  /** Close multiple tabs from a specific pane in the active session. */
  closeTabsInLeaf(leafId: string, ids: string[]) {
    if (ids.length === 0) return;
    const closeSet = new Set(ids);
    setState((prev) => {
      const active = getActiveSession(prev);
      const leaf = findLeaf(active.root, leafId);
      if (!leaf) return prev;
      const tabIds = leaf.tabIds.filter((t) => !closeSet.has(t));
      let activeTabId = leaf.activeTabId;
      if (activeTabId && closeSet.has(activeTabId)) activeTabId = tabIds[0] ?? null;

      let root = mapLeaf(active.root, leaf.id, (l) => ({ ...l, tabIds, activeTabId }));
      let focusedLeafId = active.focusedLeafId;

      if (tabIds.length === 0) {
        const parentInfo = findParent(root, leaf.id);
        if (parentInfo) {
          const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
          root = replaceNode(root, parentInfo.parent, sibling);
          if (focusedLeafId === leaf.id) focusedLeafId = getAllLeaves(sibling)[0].id;
        }
      }

      const sessions = patchActiveSession(prev, { root, focusedLeafId });
      const tabs = gcTabs({ ...prev, sessions });
      return { sessions, tabs };
    });
  },

  closeTabs(ids: string[]) {
    workspace.closeTabsInLeaf(getActiveSession().focusedLeafId, ids);
  },

  // ---------- Splitting ----------

  /** Run `opener` in a "side pane" — an existing sibling leaf if the origin
   *  pane is already in a split, otherwise a freshly-created empty pane to
   *  the right. `originTabId` pins the origin to the leaf containing that
   *  tab (used by terminal link clicks so focus race conditions don't
   *  redirect the open into the wrong leaf). Falls back to the focused
   *  leaf when no origin is given. */
  openInSide(opener: () => void | Promise<void>, originTabId?: string) {
    const active = getActiveSession(state);
    const originLeaf = originTabId
      ? findLeafByTabId(active.root, originTabId)
      : findLeaf(active.root, active.focusedLeafId);
    if (!originLeaf) {
      void opener();
      return;
    }
    const parentInfo = findParent(active.root, originLeaf.id);
    if (parentInfo) {
      // Reuse the sibling subtree — pick its first leaf so repeated clicks
      // recycle the existing side pane instead of stacking splits.
      const siblingTree = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
      const siblingLeaf =
        siblingTree.kind === 'leaf' ? siblingTree : getAllLeaves(siblingTree)[0];
      setState((prev) => ({
        sessions: patchActiveSession(prev, { focusedLeafId: siblingLeaf.id }),
      }));
      void opener();
      return;
    }
    // No sibling — split horizontally with an empty new leaf and focus it.
    let newLeafId: string | null = null;
    setState((prev) => {
      const a = getActiveSession(prev);
      const l = findLeaf(a.root, originLeaf.id);
      if (!l) return prev;
      const newLeaf: LeafNode = {
        kind: 'leaf',
        id: newNodeId('leaf'),
        tabIds: [],
        activeTabId: null,
      };
      newLeafId = newLeaf.id;
      const split: SplitNode = {
        kind: 'split',
        id: newNodeId('split'),
        direction: 'horizontal',
        ratio: 0.5,
        children: [l, newLeaf],
      };
      return {
        sessions: patchActiveSession(prev, {
          root: replaceNode(a.root, l, split),
          focusedLeafId: newLeaf.id,
        }),
      };
    });
    // Belt-and-suspenders: ensure the new leaf is focused even if a later
    // synchronous setState ran in between (e.g., a stray pane mousedown).
    if (newLeafId) {
      setState((prev) => ({
        sessions: patchActiveSession(prev, { focusedLeafId: newLeafId! }),
      }));
    }
    void opener();
  },

  splitFocused(direction: 'horizontal' | 'vertical') {
    setState((prev) => {
      const active = getActiveSession(prev);
      const leaf = findLeaf(active.root, active.focusedLeafId);
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
      const root = replaceNode(active.root, leaf, split);
      return {
        sessions: patchActiveSession(prev, { root, focusedLeafId: newLeaf.id }),
      };
    });
  },

  closePane(leafId: string) {
    setState((prev) => {
      const active = getActiveSession(prev);
      const leaf = findLeaf(active.root, leafId);
      if (!leaf) return prev;
      const parentInfo = findParent(active.root, leafId);
      if (!parentInfo) return prev; // last pane in session — refuse
      const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
      const root = replaceNode(active.root, parentInfo.parent, sibling);
      const focusedLeafId =
        active.focusedLeafId === leafId ? getAllLeaves(sibling)[0].id : active.focusedLeafId;
      const sessions = patchActiveSession(prev, { root, focusedLeafId });
      const tabs = gcTabs({ ...prev, sessions });
      return { sessions, tabs };
    });
  },

  setSplitRatio(splitId: string, ratio: number) {
    setState((prev) => {
      const active = getActiveSession(prev);
      return {
        sessions: patchActiveSession(prev, {
          root: setSplitRatio(active.root, splitId, ratio),
        }),
      };
    });
  },

  cycleLayout() {
    setState((prev) => {
      const active = getActiveSession(prev);
      const leaves = getAllLeaves(active.root);
      if (leaves.length < 2) return prev;
      const layouts = generateLayouts(leaves);
      if (layouts.length === 0) return prev;

      let cycle = prev.layoutCycle;
      if (!cycle || !sameLeafSet(getAllLeaves(cycle.originalRoot), leaves)) {
        cycle = { originalRoot: active.root, index: -1 };
      }

      const nextIndex = cycle.index + 1;
      if (nextIndex >= layouts.length) {
        return {
          sessions: patchActiveSession(prev, { root: cycle.originalRoot }),
          layoutCycle: null,
        };
      }
      return {
        sessions: patchActiveSession(prev, { root: layouts[nextIndex] }),
        layoutCycle: { originalRoot: cycle.originalRoot, index: nextIndex },
      };
    });
  },

  // ---------- Sessions ----------

  newSession(opts: { name?: string; rootDir?: string | null } = {}) {
    setState((prev) => {
      const current = getActiveSession(prev);
      // New sessions inherit the current session's rootDir by default —
      // user can change it via the workspace dropdown.
      const rootDir = opts.rootDir !== undefined ? opts.rootDir : current.rootDir;
      const session = makeFreshSession(
        opts.name ?? `Workspace ${prev.sessions.length + 1}`,
        rootDir,
      );
      return {
        sessions: [...prev.sessions, session],
        activeSessionId: session.id,
        focusToken: prev.focusToken + 1,
      };
    });
  },

  setActiveSession(sessionId: string) {
    setState((prev) =>
      prev.sessions.some((s) => s.id === sessionId)
        ? { activeSessionId: sessionId, focusToken: prev.focusToken + 1 }
        : prev,
    );
    revealActiveTabInTree();
  },

  cycleSession(delta: number) {
    setState((prev) => {
      if (prev.sessions.length < 2) return prev;
      const idx = prev.sessions.findIndex((s) => s.id === prev.activeSessionId);
      const len = prev.sessions.length;
      const next = idx < 0 ? 0 : (idx + delta + len) % len;
      return {
        activeSessionId: prev.sessions[next].id,
        focusToken: prev.focusToken + 1,
      };
    });
    revealActiveTabInTree();
  },

  closeSession(sessionId: string) {
    setState((prev) => {
      if (prev.sessions.length <= 1) return prev; // can't close the last session
      const sessions = prev.sessions.filter((s) => s.id !== sessionId);
      const activeSessionId =
        prev.activeSessionId === sessionId ? sessions[0].id : prev.activeSessionId;
      const tabs = gcTabs({ ...prev, sessions });
      return { sessions, activeSessionId, tabs };
    });
  },

  renameSession(sessionId: string, name: string) {
    setState((prev) => ({
      sessions: patchSession(prev, sessionId, { name }),
    }));
  },

  /** Move a session from one index to another. */
  reorderSession(fromIdx: number, toIdx: number) {
    setState((prev) => {
      if (fromIdx === toIdx) return prev;
      const len = prev.sessions.length;
      if (fromIdx < 0 || fromIdx >= len || toIdx < 0 || toIdx > len) return prev;
      const next = prev.sessions.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { sessions: next };
    });
  },

  /** Reorder a tab within a single pane (leaf) of the active session. */
  reorderTabInLeaf(leafId: string, fromIdx: number, toIdx: number) {
    setState((prev) => {
      if (fromIdx === toIdx) return prev;
      const active = getActiveSession(prev);
      const leaf = findLeaf(active.root, leafId);
      if (!leaf) return prev;
      const len = leaf.tabIds.length;
      if (fromIdx < 0 || fromIdx >= len || toIdx < 0 || toIdx > len) return prev;
      const ids = leaf.tabIds.slice();
      const [moved] = ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, moved);
      return {
        sessions: patchActiveSession(prev, {
          root: mapLeaf(active.root, leaf.id, (l) => ({ ...l, tabIds: ids })),
        }),
      };
    });
  },

  // ---------- Tab content ----------

  updateContent(id: string, content: string) {
    setState((prev) => ({
      tabs: prev.tabs.map((t) =>
        t.id === id ? { ...t, content, dirty: content !== t.savedContent } : t,
      ),
    }));
  },

  setMarkdownViewMode(tabId: string, mode: 'rendered' | 'raw' | 'split' | 'tree') {
    setState((prev) => ({
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, viewMode: mode } : t)),
    }));
  },

  toggleMarkdownViewMode() {
    const tab = workspace.getActiveTab();
    if (!tab) return;
    // Markdown: rendered → split → raw. JSON: tree → split → raw.
    // CSV: rendered (table) → split → raw.
    let order: Array<'rendered' | 'split' | 'raw' | 'tree'>;
    let initial: 'rendered' | 'split' | 'raw' | 'tree';
    if (tab.kind === 'markdown') {
      order = ['rendered', 'split', 'raw'];
      initial = 'rendered';
    } else if (tab.kind === 'json') {
      order = ['tree', 'split', 'raw'];
      initial = 'tree';
    } else if (tab.kind === 'csv') {
      order = ['rendered', 'split', 'raw'];
      initial = 'rendered';
    } else {
      return;
    }
    const cur = (tab.viewMode as typeof initial) ?? initial;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    setState((prev) => ({
      tabs: prev.tabs.map((t) => (t.id === tab.id ? { ...t, viewMode: next } : t)),
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
    setState((prev) => ({ sessions: patchActiveSession(prev, { rootDir: dir }) }));
    // Remember it so we can restore on next launch.
    try {
      if (dir) localStorage.setItem('marko:lastWorkspace', dir);
      else localStorage.removeItem('marko:lastWorkspace');
    } catch {
      // localStorage may be unavailable in unusual contexts
    }
  },

  toggleSidebar() {
    setState((prev) => {
      const active = getActiveSession(prev);
      return {
        sessions: patchActiveSession(prev, { sidebarVisible: !active.sidebarVisible }),
      };
    });
  },

  setSidebarVisible(visible: boolean) {
    setState((prev) => ({
      sessions: patchActiveSession(prev, { sidebarVisible: visible }),
    }));
  },

  toggleOutline() {
    setState((prev) => {
      const active = getActiveSession(prev);
      return {
        sessions: patchActiveSession(prev, { outlineVisible: !active.outlineVisible }),
      };
    });
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

  /** Mark a tab as currently playing audio/video (or stop). Called by the
   *  media viewer and webview when their <audio>/<video> elements fire
   *  play/pause events. */
  setTabPlaying(tabId: string, playing: boolean) {
    setState((prev) => {
      const has = prev.playingTabIds.includes(tabId);
      if (has === playing) return prev;
      return {
        playingTabIds: playing
          ? [...prev.playingTabIds, tabId]
          : prev.playingTabIds.filter((id) => id !== tabId),
      };
    });
  },

  /** Open a diff tab comparing two file paths. Reuses an existing diff tab
   *  if one already compares the same pair (regardless of pane). */
  openDiffTab(leftPath: string, rightPath: string) {
    const existing = state.tabs.find(
      (t) => t.kind === 'diff' && t.diffLeft === leftPath && t.diffRight === rightPath,
    );
    if (existing) {
      // Reveal existing tab if it's referenced by any session, otherwise re-attach.
      for (const session of state.sessions) {
        if (findLeafByTabId(session.root, existing.id)) {
          workspace.revealTab(existing.id);
          return;
        }
      }
    }
    const leftName = leftPath.split('/').pop() ?? 'left';
    const rightName = rightPath.split('/').pop() ?? 'right';
    const tab: Tab = {
      id: newTabId(),
      filePath: null,
      title: `${leftName} ↔ ${rightName}`,
      kind: 'diff',
      diffLeft: leftPath,
      diffRight: rightPath,
      content: '',
      savedContent: '',
      dirty: false,
    };
    setState((prev) => {
      const active = getActiveSession(prev);
      return {
        tabs: [...prev.tabs, tab],
        sessions: patchActiveSession(prev, {
          root: mapLeaf(active.root, active.focusedLeafId, (l) => ({
            ...l,
            tabIds: [...l.tabIds, tab.id],
            activeTabId: tab.id,
          })),
        }),
        focusToken: prev.focusToken + 1,
      };
    });
  },

  /** Switch to whichever session contains the given tab and focus it.
   *  Used by the now-playing button in the titlebar. */
  revealTab(tabId: string) {
    setState((prev) => {
      for (const session of prev.sessions) {
        const leaf = findLeafByTabId(session.root, tabId);
        if (!leaf) continue;
        const sessions = patchSession(prev, session.id, {
          focusedLeafId: leaf.id,
          root: mapLeaf(session.root, leaf.id, (l) => ({ ...l, activeTabId: tabId })),
        });
        return {
          sessions,
          activeSessionId: session.id,
          focusToken: prev.focusToken + 1,
        };
      }
      return prev;
    });
  },
};

// ---------- Persistence ----------

const SNAPSHOT_VERSION = 1;

interface PersistedTab {
  id: string;
  filePath: string | null;
  title: string;
  kind: TabKind;
  language?: string;
  ext?: string;
  viewMode?: 'rendered' | 'raw' | 'split' | 'tree';
  diffLeft?: string;
  diffRight?: string;
  pinned?: boolean;
  /** Only persisted for unsaved scratch tabs (no filePath). For tabs with a
   *  filePath we re-read from disk on hydrate. */
  scratchContent?: string;
}

interface Snapshot {
  version: number;
  tabs: PersistedTab[];
  sessions: Session[];
  activeSessionId: string;
  /** Legacy global flags — retained for back-compat with snapshots written
   *  before these became per-session. New code reads/writes
   *  Session.sidebarVisible / Session.outlineVisible instead. */
  sidebarVisible?: boolean;
  outlineVisible?: boolean;
}

/** Build a JSON-safe snapshot of the current workspace. */
export function serializeWorkspace(): Snapshot {
  // Drop tabs we can't restore: terminal (PTY can't be revived).
  const persistableTabs: PersistedTab[] = [];
  const droppedTabIds = new Set<string>();
  for (const tab of state.tabs) {
    if (tab.kind === 'terminal') {
      droppedTabIds.add(tab.id);
      continue;
    }
    const persisted: PersistedTab = {
      id: tab.id,
      filePath: tab.filePath,
      title: tab.title,
      kind: tab.kind,
      language: tab.language,
      ext: tab.ext,
      viewMode: tab.viewMode,
      diffLeft: tab.diffLeft,
      diffRight: tab.diffRight,
      pinned: tab.pinned,
    };
    // Untitled scratch buffers: persist content directly so the user doesn't
    // lose work. File-backed tabs re-read from disk on hydrate.
    if (
      !tab.filePath &&
      (tab.kind === 'markdown' ||
        tab.kind === 'code' ||
        tab.kind === 'excalidraw' ||
        tab.kind === 'chat' ||
        tab.kind === 'http')
    ) {
      persisted.scratchContent = tab.content;
    }
    persistableTabs.push(persisted);
  }

  // Strip dropped tab ids from any leaf in any session.
  const stripLeaf = (l: LeafNode): LeafNode => {
    if (droppedTabIds.size === 0) return l;
    const tabIds = l.tabIds.filter((id) => !droppedTabIds.has(id));
    let activeTabId = l.activeTabId;
    if (activeTabId && droppedTabIds.has(activeTabId)) {
      activeTabId = tabIds[0] ?? null;
    }
    return { ...l, tabIds, activeTabId };
  };
  const sessions: Session[] = state.sessions.map((sess) => ({
    ...sess,
    root: mapAllLeaves(sess.root, stripLeaf),
  }));

  return {
    version: SNAPSHOT_VERSION,
    tabs: persistableTabs,
    sessions,
    activeSessionId: state.activeSessionId,
  };
}

/** Pull the largest numeric suffix out of an id like "tab-12" or "leaf-7". */
function maxIdSuffix(prefix: string, ids: string[]): number {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const id of ids) {
    const m = re.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

/** Apply a snapshot. File-backed tabs are loaded asynchronously: each tab
 *  shows the title immediately and gets its content populated as `readFile`
 *  resolves. Image tabs re-load from disk into a data URL. */
export async function hydrateFromSnapshot(snapshot: Snapshot): Promise<void> {
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION) return;
  if (!snapshot.sessions || snapshot.sessions.length === 0) return;

  // Stub all tabs first so the UI can render with placeholders, then fill in
  // content per tab as its async load resolves.
  const stubTabs: Tab[] = snapshot.tabs.map((p) => ({
    id: p.id,
    filePath: p.filePath,
    title: p.title,
    kind: p.kind,
    language: p.language,
    ext: p.ext,
    viewMode: p.viewMode,
    diffLeft: p.diffLeft,
    diffRight: p.diffRight,
    pinned: p.pinned,
    content: p.scratchContent ?? '',
    savedContent: p.scratchContent ?? '',
    dirty: false,
  }));

  // Advance id counters past anything in the snapshot so new ids don't clash.
  const allTabIds = stubTabs.map((t) => t.id);
  const allNodeIds: string[] = [];
  for (const s of snapshot.sessions) {
    const visit = (n: PaneTree) => {
      allNodeIds.push(n.id);
      if (n.kind === 'split') {
        visit(n.children[0]);
        visit(n.children[1]);
      }
    };
    visit(s.root);
  }
  const allSessionIds = snapshot.sessions.map((s) => s.id);
  nextTabId = Math.max(nextTabId, maxIdSuffix('tab', allTabIds) + 1);
  nextNodeId = Math.max(
    nextNodeId,
    maxIdSuffix('leaf', allNodeIds) + 1,
    maxIdSuffix('split', allNodeIds) + 1,
  );
  nextSessionId = Math.max(nextSessionId, maxIdSuffix('session', allSessionIds) + 1);

  // Back-compat: older snapshots stored global `sidebarVisible` /
  // `outlineVisible` flags. Migrate each onto sessions that don't already
  // carry the field.
  const legacySidebar = snapshot.sidebarVisible;
  const legacyOutline = snapshot.outlineVisible;
  const migratedSessions: Session[] = snapshot.sessions.map((sess) => ({
    ...sess,
    sidebarVisible:
      typeof sess.sidebarVisible === 'boolean'
        ? sess.sidebarVisible
        : (legacySidebar ?? true),
    outlineVisible:
      typeof sess.outlineVisible === 'boolean'
        ? sess.outlineVisible
        : (legacyOutline ?? false),
  }));

  // Apply the stub state synchronously so the window paints immediately.
  setState({
    tabs: stubTabs,
    sessions: migratedSessions,
    activeSessionId: snapshot.activeSessionId,
    layoutCycle: null,
    folderSelection: null,
    revealPath: null,
  });

  // Lazy-load each tab's content. Done concurrently; failures (file moved/
  // deleted) leave the stub in place with a placeholder title hint.
  await Promise.all(
    snapshot.tabs.map(async (p) => {
      if (!p.filePath) return; // scratch already filled in via stubTabs
      try {
        if (p.kind === 'image') {
          const dataUrl = await window.marko.loadImage(p.filePath);
          setState((prev) => ({
            tabs: prev.tabs.map((t) =>
              t.id === p.id ? { ...t, content: dataUrl, savedContent: dataUrl } : t,
            ),
          }));
        } else if (
          p.kind === 'binary' ||
          p.kind === 'folder' ||
          p.kind === 'web' ||
          p.kind === 'media' ||
          p.kind === 'pdf' ||
          p.kind === 'diff'
        ) {
          // Nothing to load — these have no editable content.
        } else {
          const content = await window.marko.readFile(p.filePath);
          setState((prev) => ({
            tabs: prev.tabs.map((t) =>
              t.id === p.id ? { ...t, content, savedContent: content, dirty: false } : t,
            ),
          }));
        }
      } catch {
        // File gone / unreadable. Mark with a small hint so the user notices.
        setState((prev) => ({
          tabs: prev.tabs.map((t) =>
            t.id === p.id ? { ...t, title: `${t.title} (missing)` } : t,
          ),
        }));
      }
    }),
  );
}
