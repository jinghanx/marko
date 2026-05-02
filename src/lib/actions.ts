import { workspace, getActiveSession, type TabKind } from '../state/workspace';
import { settings } from '../state/settings';
import { detectKind, looksBinary } from './fileType';

function maybeRevealInTree(path: string) {
  const root = getActiveSession().rootDir;
  if (!root) return;
  if (path === root || path.startsWith(root + '/')) {
    workspace.revealInTree(path);
  }
}

function classify(filePath: string, content: string): { kind: TabKind; content: string } {
  const kind = detectKind(filePath);
  if (kind === 'binary' || kind === 'image' || kind === 'media' || kind === 'pdf') {
    return { kind, content: '' };
  }
  if (kind === 'code' && looksBinary(content)) return { kind: 'binary', content: '' };
  // csv / json keep their content (the viewer parses it on every render).
  return { kind, content };
}

export async function openFileViaDialog() {
  const result = await window.marko.openFileDialog();
  if (!result) return;
  const title = await window.marko.basename(result.filePath);
  const kindByExt = detectKind(result.filePath);
  if (kindByExt === 'image') {
    const dataUrl = await window.marko.loadImage(result.filePath);
    workspace.openFileTab(result.filePath, dataUrl, title, 'image');
    settings.pushRecentFile(result.filePath);
    workspace.requestEditorFocus();
    return;
  }
  if (kindByExt === 'media') {
    workspace.openFileTab(result.filePath, '', title, 'media');
    settings.pushRecentFile(result.filePath);
    workspace.requestEditorFocus();
    return;
  }
  if (kindByExt === 'pdf') {
    workspace.openFileTab(result.filePath, '', title, 'pdf');
    settings.pushRecentFile(result.filePath);
    workspace.requestEditorFocus();
    return;
  }
  const { kind, content } = classify(result.filePath, result.content);
  workspace.openFileTab(result.filePath, content, title, kind);
  settings.pushRecentFile(result.filePath);
  workspace.requestEditorFocus();
}

// Loose URL heuristic: explicit protocol, or a host-with-TLD pattern.
const URL_RE = /^(https?:\/\/|[\w-]+(?:\.[\w-]+)+(?:\/.*)?$)/i;

export function looksLikeUrl(input: string): boolean {
  const s = input.trim();
  if (!s || s.includes(' ')) return false;
  return URL_RE.test(s);
}

export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

/** Run an opener so that whatever tab it lands on replaces the currently
 *  active tab in the focused pane (the prior tab is closed if a different
 *  tab was created/activated). */
export async function withReplace(opener: () => Promise<unknown> | void) {
  const prevId = workspace.getFocusedLeaf().activeTabId;
  await Promise.resolve(opener());
  const next = workspace.getActiveTab();
  if (prevId && next && next.id !== prevId) {
    workspace.closeTab(prevId);
  }
}

export function openTerminalTab(opts: { focus?: boolean } = {}) {
  const focus = opts.focus ?? true;
  const tab = workspace.openNewTab({ kind: 'terminal', title: 'Terminal' });
  if (focus) workspace.requestEditorFocus();
  return tab;
}

export function openProcessTab(opts: { focus?: boolean } = {}) {
  const focus = opts.focus ?? true;
  const tab = workspace.openNewTab({ kind: 'process', title: 'Activity' });
  if (focus) workspace.requestEditorFocus();
  return tab;
}

export function openGitTab(opts: { focus?: boolean } = {}) {
  const focus = opts.focus ?? true;
  const tab = workspace.openNewTab({ kind: 'git', title: 'Git' });
  if (focus) workspace.requestEditorFocus();
  return tab;
}

export function openExcalidrawTab(opts: { focus?: boolean } = {}) {
  const focus = opts.focus ?? true;
  const tab = workspace.openNewTab({
    kind: 'excalidraw',
    title: 'Whiteboard',
    ext: '.excalidraw',
  });
  if (focus) workspace.requestEditorFocus();
  return tab;
}

export function openChatTab(opts: { focus?: boolean } = {}) {
  const focus = opts.focus ?? true;
  const tab = workspace.openNewTab({ kind: 'chat', title: 'Chat' });
  if (focus) workspace.requestEditorFocus();
  return tab;
}

export function openSearchTab(opts: { focus?: boolean } = {}) {
  const focus = opts.focus ?? true;
  const tab = workspace.openNewTab({ kind: 'search', title: 'Search' });
  if (focus) workspace.requestEditorFocus();
  return tab;
}

export function openHttpTab(opts: { focus?: boolean } = {}) {
  const focus = opts.focus ?? true;
  const tab = workspace.openNewTab({ kind: 'http', title: 'HTTP' });
  if (focus) workspace.requestEditorFocus();
  return tab;
}

/** Reveal the existing clipboard-history tab if one is open in the active
 *  session, otherwise open a fresh one. The clipboard log is global, so
 *  multiple tabs would just show the same thing. */
export function openClipboardTab(opts: { focus?: boolean } = {}) {
  const focus = opts.focus ?? true;
  const existing = workspace.getState().tabs.find((t) => t.kind === 'clipboard');
  if (existing) {
    workspace.revealTab(existing.id);
    if (focus) workspace.requestEditorFocus();
    return existing;
  }
  const tab = workspace.openNewTab({ kind: 'clipboard', title: 'Clipboard' });
  if (focus) workspace.requestEditorFocus();
  return tab;
}

/** Reveal the existing shortcuts tab if one is open, otherwise open a
 *  fresh one. Single-instance like settings/clipboard. */
export function openShortcutsTab(opts: { focus?: boolean } = {}) {
  const focus = opts.focus ?? true;
  const existing = workspace.getState().tabs.find((t) => t.kind === 'shortcuts');
  if (existing) {
    workspace.revealTab(existing.id);
    if (focus) workspace.requestEditorFocus();
    return existing;
  }
  const tab = workspace.openNewTab({ kind: 'shortcuts', title: 'Shortcuts' });
  if (focus) workspace.requestEditorFocus();
  return tab;
}

/** Reveal the existing settings tab if one is open, otherwise open a fresh
 *  one. Settings are global, so a single instance is the right model. */
export function openSettingsTab(opts: { focus?: boolean } = {}) {
  const focus = opts.focus ?? true;
  const existing = workspace.getState().tabs.find((t) => t.kind === 'settings');
  if (existing) {
    workspace.revealTab(existing.id);
    if (focus) workspace.requestEditorFocus();
    return existing;
  }
  const tab = workspace.openNewTab({ kind: 'settings', title: 'Settings' });
  if (focus) workspace.requestEditorFocus();
  return tab;
}

export function openUrlInTab(rawUrl: string, opts: { focus?: boolean } = {}) {
  const focus = opts.focus ?? true;
  const url = normalizeUrl(rawUrl);
  let title = url;
  try {
    title = new URL(url).hostname;
  } catch {
    // ignore
  }
  workspace.openFileTab(url, url, title, 'web');
  settings.pushRecentUrl(url);
  if (focus) workspace.requestEditorFocus();
}

export async function openFolderInEditor(folderPath: string, opts: { focus?: boolean } = {}) {
  const focus = opts.focus ?? false;
  const title = await window.marko.basename(folderPath);
  workspace.openFileTab(folderPath, '', title || folderPath, 'folder');
  maybeRevealInTree(folderPath);
  if (focus) workspace.requestEditorFocus();
}

export async function openFolderViaDialog() {
  const dir = await window.marko.openFolderDialog();
  if (!dir) return;
  workspace.setRootDir(dir);
  workspace.setSidebarVisible(true);
}

export async function openFileFromPath(filePath: string, opts: { focus?: boolean } = {}) {
  const focus = opts.focus ?? true;
  const kindByExt = detectKind(filePath);
  const title = await window.marko.basename(filePath);
  if (kindByExt === 'binary') {
    workspace.openFileTab(filePath, '', title, 'binary');
    settings.pushRecentFile(filePath);
    maybeRevealInTree(filePath);
    return;
  }
  if (kindByExt === 'image') {
    const dataUrl = await window.marko.loadImage(filePath);
    workspace.openFileTab(filePath, dataUrl, title, 'image');
    settings.pushRecentFile(filePath);
    maybeRevealInTree(filePath);
    if (focus) workspace.requestEditorFocus();
    return;
  }
  if (kindByExt === 'media') {
    // No content to load — MediaViewer streams the file via marko-file://.
    workspace.openFileTab(filePath, '', title, 'media');
    settings.pushRecentFile(filePath);
    maybeRevealInTree(filePath);
    if (focus) workspace.requestEditorFocus();
    return;
  }
  if (kindByExt === 'pdf') {
    // Same story for PDFs — PdfViewer streams via marko-file://.
    workspace.openFileTab(filePath, '', title, 'pdf');
    settings.pushRecentFile(filePath);
    maybeRevealInTree(filePath);
    if (focus) workspace.requestEditorFocus();
    return;
  }
  if (kindByExt === 'sqlite') {
    // SQLite databases never load content into the renderer; the SqliteView
    // component opens a connection through main and queries on demand.
    workspace.openFileTab(filePath, '', title, 'sqlite');
    settings.pushRecentFile(filePath);
    maybeRevealInTree(filePath);
    if (focus) workspace.requestEditorFocus();
    return;
  }
  const content = await window.marko.readFile(filePath);
  const { kind, content: c } = classify(filePath, content);
  workspace.openFileTab(filePath, c, title, kind);
  settings.pushRecentFile(filePath);
  maybeRevealInTree(filePath);
  if (focus) workspace.requestEditorFocus();
}

export async function saveActive() {
  const tab = workspace.getActiveTab();
  if (!tab || tab.kind === 'binary' || tab.kind === 'image') return;
  if (!tab.filePath) {
    return saveActiveAs();
  }
  await window.marko.writeFile(tab.filePath, tab.content);
  workspace.markSaved(tab.id, tab.filePath, tab.title);
}

export async function saveActiveAs() {
  const tab = workspace.getActiveTab();
  if (!tab || tab.kind === 'binary' || tab.kind === 'image') return;
  const ext =
    tab.ext ??
    (tab.kind === 'markdown'
      ? '.md'
      : tab.kind === 'excalidraw'
        ? '.excalidraw'
        : '.txt');
  const baseTitle = tab.title || 'untitled';
  const suggested = tab.filePath ?? (baseTitle.endsWith(ext) ? baseTitle : `${baseTitle}${ext}`);
  const filePath = await window.marko.saveAsDialog(suggested);
  if (!filePath) return;
  await window.marko.writeFile(filePath, tab.content);
  const title = await window.marko.basename(filePath);
  workspace.markSaved(tab.id, filePath, title);
}

export function closeActiveTab() {
  const tab = workspace.getActiveTab();
  if (!tab) return;
  if (tab.dirty) {
    const confirmClose = window.confirm(`"${tab.title}" has unsaved changes. Close anyway?`);
    if (!confirmClose) return;
  }
  workspace.closeTab(tab.id);
}
