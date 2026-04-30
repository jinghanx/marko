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

  onMenu: (channel: string, handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('marko', api);

export type MarkoApi = typeof api;
