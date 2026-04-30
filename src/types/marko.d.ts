/// <reference types="vite/client" />

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

export interface MarkoApi {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<boolean>;
  openFileDialog(): Promise<{ filePath: string; content: string } | null>;
  openFolderDialog(): Promise<string | null>;
  saveAsDialog(suggestedName?: string): Promise<string | null>;
  listDir(dirPath: string): Promise<DirEntry[]>;
  basename(p: string): Promise<string>;
  homeDir(): Promise<string>;
  createFile(filePath: string): Promise<{ ok: boolean; error?: string }>;
  createDir(dirPath: string): Promise<{ ok: boolean; error?: string }>;
  rename(oldPath: string, newPath: string): Promise<{ ok: boolean; error?: string }>;
  copy(src: string, dest: string): Promise<{ ok: boolean; error?: string }>;
  exists(p: string): Promise<boolean>;
  trash(filePath: string): Promise<{ ok: boolean; error?: string }>;
  revealInFinder(filePath: string): Promise<void>;
  quickLook(filePath: string): Promise<{ ok: boolean; error?: string }>;
  stat(filePath: string): Promise<{ exists: boolean; isFile: boolean; isDirectory: boolean; error?: string }>;
  openDefault(filePath: string): Promise<{ ok: boolean; error?: string }>;
  loadImage(filePath: string): Promise<string>;
  walkDir(rootDir: string): Promise<string[]>;
  listProcesses(): Promise<ProcInfo[]>;
  killProcess(pid: number, signal?: string): Promise<{ ok: boolean; error?: string }>;
  systemStats(): Promise<SystemStats>;
  onMenu(channel: string, handler: () => void): () => void;
}

declare global {
  interface Window {
    marko: MarkoApi;
  }
}

declare module '*.css?url' {
  const url: string;
  export default url;
}
