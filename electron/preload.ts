import { contextBridge, ipcRenderer } from 'electron';

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

export interface ProcInfo {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  vsz: number;
  rss: number;
  state: string;
  time: string;
  command: string;
  args: string;
}

export interface SystemStats {
  cpus: number[];
  memUsed: number;
  memTotal: number;
  loadavg: [number, number, number];
  uptime: number;
}

const api = {
  readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('file:write', filePath, content),
  openFileDialog: (): Promise<{ filePath: string; content: string } | null> =>
    ipcRenderer.invoke('dialog:open-file'),
  openFolderDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:open-folder'),
  saveAsDialog: (suggestedName?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:save-as', suggestedName),
  listDir: (dirPath: string): Promise<DirEntry[]> => ipcRenderer.invoke('dir:list', dirPath),
  basename: (p: string): Promise<string> => ipcRenderer.invoke('path:basename', p),
  homeDir: (): Promise<string> => ipcRenderer.invoke('path:home'),
  configDir: (): Promise<string> => ipcRenderer.invoke('marko:config-dir'),
  notesPath: (): Promise<string> => ipcRenderer.invoke('marko:notes-path'),
  createFile: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('file:create', filePath),
  createDir: (dirPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('dir:create', dirPath),
  rename: (oldPath: string, newPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:rename', oldPath, newPath),
  copy: (src: string, dest: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:copy', src, dest),
  exists: (p: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', p),
  trash: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:trash', filePath),
  revealInFinder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('fs:reveal', filePath),
  quickLook: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:quicklook', filePath),
  stat: (filePath: string): Promise<{ exists: boolean; isFile: boolean; isDirectory: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:stat', filePath),
  openDefault: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:open-default', filePath),
  loadImage: (filePath: string): Promise<string> => ipcRenderer.invoke('image:load', filePath),
  walkDir: (rootDir: string): Promise<string[]> => ipcRenderer.invoke('dir:walk', rootDir),
  listProcesses: (): Promise<ProcInfo[]> => ipcRenderer.invoke('ps:list'),
  killProcess: (pid: number, signal?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('ps:kill', pid, signal),
  systemStats: (): Promise<SystemStats> => ipcRenderer.invoke('system:stats'),

  // ---------- Persisted workspace state (~/.marko/state.json) ----------
  stateRead: (): Promise<string | null> => ipcRenderer.invoke('state:read'),
  stateWrite: (json: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('state:write', json),
  stateReset: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('state:reset'),

  /** Native rich confirm dialog (formats long content properly). */
  confirm: (opts: {
    message: string;
    detail?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    dangerous?: boolean;
  }): Promise<boolean> => ipcRenderer.invoke('app:confirm', opts),

  // ---------- Git ----------
  gitInit: (repoDir: string) => ipcRenderer.invoke('git:init', repoDir),
  gitStatus: (repoDir: string) => ipcRenderer.invoke('git:status', repoDir),
  gitDiff: (repoDir: string, relPath: string, staged: boolean) =>
    ipcRenderer.invoke('git:diff', repoDir, relPath, staged),
  gitStage: (repoDir: string, paths: string[]) =>
    ipcRenderer.invoke('git:stage', repoDir, paths),
  gitUnstage: (repoDir: string, paths: string[]) =>
    ipcRenderer.invoke('git:unstage', repoDir, paths),
  gitDiscard: (repoDir: string, paths: string[]) =>
    ipcRenderer.invoke('git:discard', repoDir, paths),
  gitCommit: (repoDir: string, message: string) =>
    ipcRenderer.invoke('git:commit', repoDir, message),
  gitBranches: (repoDir: string) => ipcRenderer.invoke('git:branches', repoDir),
  gitCheckout: (repoDir: string, branch: string) =>
    ipcRenderer.invoke('git:checkout', repoDir, branch),
  gitRebase: (repoDir: string, target: string) =>
    ipcRenderer.invoke('git:rebase', repoDir, target),
  gitMerge: (repoDir: string, target: string) =>
    ipcRenderer.invoke('git:merge', repoDir, target),
  gitFetch: (repoDir: string) => ipcRenderer.invoke('git:fetch', repoDir),
  gitPull: (repoDir: string) => ipcRenderer.invoke('git:pull', repoDir),
  gitPush: (repoDir: string) => ipcRenderer.invoke('git:push', repoDir),
  gitStashList: (repoDir: string) => ipcRenderer.invoke('git:stashList', repoDir),
  gitStashSave: (repoDir: string, message: string) =>
    ipcRenderer.invoke('git:stashSave', repoDir, message),
  gitStashApply: (repoDir: string, ref: string) =>
    ipcRenderer.invoke('git:stashApply', repoDir, ref),
  gitStashPop: (repoDir: string, ref: string) =>
    ipcRenderer.invoke('git:stashPop', repoDir, ref),
  gitStashDrop: (repoDir: string, ref: string) =>
    ipcRenderer.invoke('git:stashDrop', repoDir, ref),
  gitStashClear: (repoDir: string) => ipcRenderer.invoke('git:stashClear', repoDir),
  gitDeleteBranch: (repoDir: string, name: string) =>
    ipcRenderer.invoke('git:deleteBranch', repoDir, name),

  // ---------- AI chat ----------
  aiProviders: () => ipcRenderer.invoke('ai:providers'),
  aiProviderSave: (p: unknown) => ipcRenderer.invoke('ai:provider-save', p),
  aiProviderDelete: (id: string) => ipcRenderer.invoke('ai:provider-delete', id),
  aiSetKey: (id: string, key: string) => ipcRenderer.invoke('ai:set-key', id, key),
  aiHasKey: (id: string) => ipcRenderer.invoke('ai:has-key', id),
  aiDeleteKey: (id: string) => ipcRenderer.invoke('ai:delete-key', id),
  aiChatStart: (reqId: string, args: unknown) =>
    ipcRenderer.invoke('ai:chat-start', reqId, args),
  aiChatCancel: (reqId: string) => ipcRenderer.invoke('ai:chat-cancel', reqId),
  onAiChatChunk: (reqId: string, handler: (chunk: string) => void) => {
    const ch = `ai:chat:chunk:${reqId}`;
    const listener = (_e: unknown, chunk: string) => handler(chunk);
    ipcRenderer.on(ch, listener);
    return () => ipcRenderer.removeListener(ch, listener);
  },
  onAiChatDone: (
    reqId: string,
    handler: (result: { ok: boolean; error?: string }) => void,
  ) => {
    const ch = `ai:chat:done:${reqId}`;
    const listener = (_e: unknown, r: { ok: boolean; error?: string }) => handler(r);
    ipcRenderer.on(ch, listener);
    return () => ipcRenderer.removeListener(ch, listener);
  },

  // ---------- Find-in-files (ripgrep) ----------
  searchStart: (reqId: string, args: unknown) =>
    ipcRenderer.invoke('search:start', reqId, args),
  searchCancel: (reqId: string) => ipcRenderer.invoke('search:cancel', reqId),
  onSearchMatch: (
    reqId: string,
    handler: (m: {
      path: string;
      lineNumber: number;
      text: string;
      submatches: Array<{ start: number; end: number }>;
    }) => void,
  ) => {
    const ch = `search:match:${reqId}`;
    const listener = (_e: unknown, m: Parameters<typeof handler>[0]) => handler(m);
    ipcRenderer.on(ch, listener);
    return () => ipcRenderer.removeListener(ch, listener);
  },
  onSearchDone: (
    reqId: string,
    handler: (r: { ok: boolean; error?: string; exitCode?: number | null }) => void,
  ) => {
    const ch = `search:done:${reqId}`;
    const listener = (_e: unknown, r: Parameters<typeof handler>[0]) => handler(r);
    ipcRenderer.on(ch, listener);
    return () => ipcRenderer.removeListener(ch, listener);
  },

  // ---------- HTTP client ----------
  httpRequest: (req: unknown) => ipcRenderer.invoke('http:request', req),

  // ---------- Chat history archive ----------
  chatHistoryList: () => ipcRenderer.invoke('chat-history:list'),
  chatHistorySave: (id: string, data: unknown) =>
    ipcRenderer.invoke('chat-history:save', id, data),
  chatHistoryLoad: (id: string) => ipcRenderer.invoke('chat-history:load', id),
  chatHistoryDelete: (id: string) => ipcRenderer.invoke('chat-history:delete', id),

  // ---------- SQLite ----------
  sqliteOpen: (filePath: string) => ipcRenderer.invoke('sqlite:open', filePath),
  sqliteClose: (filePath: string) => ipcRenderer.invoke('sqlite:close', filePath),
  sqliteSchema: (filePath: string) => ipcRenderer.invoke('sqlite:schema', filePath),
  sqliteQuery: (filePath: string, sql: string) =>
    ipcRenderer.invoke('sqlite:query', filePath, sql),

  // ---------- Clipboard history ----------
  clipboardList: () => ipcRenderer.invoke('clipboard:list'),
  clipboardWrite: (id: string) => ipcRenderer.invoke('clipboard:write', id),
  clipboardDelete: (id: string) => ipcRenderer.invoke('clipboard:delete', id),
  clipboardClear: () => ipcRenderer.invoke('clipboard:clear'),
  clipboardPin: (id: string, pinned: boolean) =>
    ipcRenderer.invoke('clipboard:pin', id, pinned),
  clipboardSetPaused: (paused: boolean) =>
    ipcRenderer.invoke('clipboard:set-paused', paused),
  clipboardGetPaused: (): Promise<boolean> => ipcRenderer.invoke('clipboard:get-paused'),
  onClipboardChanged: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on('clipboard:changed', listener);
    return () => ipcRenderer.removeListener('clipboard:changed', listener);
  },
  gitApplyPatch: (
    repoDir: string,
    patch: string,
    opts: { cached?: boolean; reverse?: boolean },
  ) => ipcRenderer.invoke('git:applyPatch', repoDir, patch, opts),
  gitLog: (repoDir: string, opts?: { limit?: number; ref?: string }) =>
    ipcRenderer.invoke('git:log', repoDir, opts ?? {}),
  gitShow: (repoDir: string, hash: string) =>
    ipcRenderer.invoke('git:show', repoDir, hash),
  gitCherryPick: (repoDir: string, hash: string) =>
    ipcRenderer.invoke('git:cherryPick', repoDir, hash),
  gitTags: (repoDir: string) => ipcRenderer.invoke('git:tags', repoDir),
  gitCreateTag: (repoDir: string, name: string, message: string) =>
    ipcRenderer.invoke('git:createTag', repoDir, name, message),
  gitDeleteTag: (repoDir: string, name: string) =>
    ipcRenderer.invoke('git:deleteTag', repoDir, name),

  onMenu: (channel: string, handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  // ---------- Terminal ----------
  ptySpawn: (id: string, opts: { cwd?: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke('pty:spawn', id, opts),
  ptyWrite: (id: string, data: string) => ipcRenderer.invoke('pty:write', id, data),
  ptyResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke('pty:resize', id, cols, rows),
  ptyKill: (id: string) => ipcRenderer.invoke('pty:kill', id),
  onPtyData: (id: string, handler: (data: string) => void) => {
    const listener = (_e: unknown, ptyId: string, data: string) => {
      if (ptyId === id) handler(data);
    };
    ipcRenderer.on('pty:data', listener);
    return () => ipcRenderer.removeListener('pty:data', listener);
  },
  onPtyExit: (id: string, handler: (exitCode: number) => void) => {
    const listener = (_e: unknown, ptyId: string, exitCode: number) => {
      if (ptyId === id) handler(exitCode);
    };
    ipcRenderer.on('pty:exit', listener);
    return () => ipcRenderer.removeListener('pty:exit', listener);
  },

  // ---------- Launcher (main window receives dispatched actions) ----------
  onLauncherRun: (handler: (action: unknown) => void) => {
    const listener = (_e: unknown, action: unknown) => handler(action);
    ipcRenderer.on('launcher:run', listener);
    return () => ipcRenderer.removeListener('launcher:run', listener);
  },

  // ---------- Application discovery (used by launcher autocomplete) ----------
  listApps: (): Promise<{ name: string; path: string }[]> =>
    ipcRenderer.invoke('apps:list'),
  appIcon: (appPath: string): Promise<string | null> =>
    ipcRenderer.invoke('apps:icon', appPath),
};

contextBridge.exposeInMainWorld('marko', api);

// Launcher-window-only API. Both windows load the same preload (Electron
// doesn't support per-window preload paths cleanly with vite-plugin-electron),
// so this just exposes the launcher-specific helpers under a separate name
// — only the launcher renderer uses them.
const launcherApi = {
  hide: () => ipcRenderer.invoke('launcher:hide'),
  dispatch: (action: unknown) => ipcRenderer.invoke('launcher:dispatch', action),
  onShow: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on('launcher:show', listener);
    return () => ipcRenderer.removeListener('launcher:show', listener);
  },
};
contextBridge.exposeInMainWorld('markoLauncher', launcherApi);

export type MarkoApi = typeof api;
export type MarkoLauncherApi = typeof launcherApi;
