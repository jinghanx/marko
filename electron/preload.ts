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
};

contextBridge.exposeInMainWorld('marko', api);

export type MarkoApi = typeof api;
