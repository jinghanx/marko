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

export interface GitFileEntry {
  path: string;
  index: string;
  workingDir: string;
  staged: boolean;
}

export interface GitStatusInfo {
  isRepo: boolean;
  branch: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  files: GitFileEntry[];
  error?: string;
}

export interface GitBranchInfo {
  current: string;
  local: string[];
  remote: string[];
}

export interface GitStashEntry {
  ref: string;
  message: string;
  date: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  parents: string[];
}

export interface AiProvider {
  id: string;
  name: string;
  baseURL: string;
  defaultModel: string;
  needsKey: boolean;
  isLocal: boolean;
  extraHeaders?: Record<string, string>;
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiChatStartArgs {
  providerId: string;
  model: string;
  messages: AiChatMessage[];
  systemPrompt?: string;
}

export interface SearchArgs {
  rootDir: string;
  query: string;
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
  glob?: string;
}

export interface SearchMatch {
  path: string;
  lineNumber: number;
  text: string;
  submatches: Array<{ start: number; end: number }>;
}

export interface HttpHeader {
  key: string;
  value: string;
  enabled: boolean;
}

export interface HttpRequestArgs {
  method: string;
  url: string;
  headers: HttpHeader[];
  body?: string;
}

export interface HttpResponseInfo {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  timeMs: number;
  size?: number;
  error?: string;
}

export interface ChatHistoryEntry {
  id: string;
  title: string;
  providerId: string;
  model: string;
  messageCount: number;
  updatedAt: number;
  preview: string;
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
  configDir(): Promise<string>;
  notesPath(): Promise<string>;
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
  stateRead(): Promise<string | null>;
  stateWrite(json: string): Promise<{ ok: boolean }>;
  stateReset(): Promise<{ ok: boolean }>;
  confirm(opts: {
    message: string;
    detail?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    dangerous?: boolean;
  }): Promise<boolean>;
  gitStatus(repoDir: string): Promise<GitStatusInfo>;
  gitDiff(repoDir: string, relPath: string, staged: boolean): Promise<{ ok: boolean; diff?: string; error?: string }>;
  gitStage(repoDir: string, paths: string[]): Promise<{ ok: boolean; error?: string }>;
  gitUnstage(repoDir: string, paths: string[]): Promise<{ ok: boolean; error?: string }>;
  gitDiscard(repoDir: string, paths: string[]): Promise<{ ok: boolean; error?: string }>;
  gitCommit(repoDir: string, message: string): Promise<{ ok: boolean; error?: string }>;
  gitBranches(repoDir: string): Promise<{ ok: boolean; data?: GitBranchInfo; error?: string }>;
  gitCheckout(repoDir: string, branch: string): Promise<{ ok: boolean; error?: string }>;
  gitRebase(repoDir: string, target: string): Promise<{ ok: boolean; error?: string }>;
  gitMerge(repoDir: string, target: string): Promise<{ ok: boolean; error?: string }>;
  gitFetch(repoDir: string): Promise<{ ok: boolean; error?: string }>;
  gitPull(repoDir: string): Promise<{ ok: boolean; error?: string }>;
  gitPush(repoDir: string): Promise<{ ok: boolean; error?: string }>;
  gitStashList(repoDir: string): Promise<{ ok: boolean; items?: GitStashEntry[]; error?: string }>;
  gitStashSave(repoDir: string, message: string): Promise<{ ok: boolean; error?: string }>;
  gitStashApply(repoDir: string, ref: string): Promise<{ ok: boolean; error?: string }>;
  gitStashPop(repoDir: string, ref: string): Promise<{ ok: boolean; error?: string }>;
  gitStashDrop(repoDir: string, ref: string): Promise<{ ok: boolean; error?: string }>;
  gitStashClear(repoDir: string): Promise<{ ok: boolean; error?: string }>;
  gitDeleteBranch(repoDir: string, name: string): Promise<{ ok: boolean; error?: string }>;
  aiProviders(): Promise<AiProvider[]>;
  aiProviderSave(p: AiProvider): Promise<{ ok: boolean; error?: string }>;
  aiProviderDelete(id: string): Promise<{ ok: boolean }>;
  aiSetKey(id: string, key: string): Promise<{ ok: boolean; error?: string }>;
  aiHasKey(id: string): Promise<boolean>;
  aiDeleteKey(id: string): Promise<{ ok: boolean }>;
  aiChatStart(reqId: string, args: AiChatStartArgs): Promise<{ ok: boolean; error?: string }>;
  aiChatCancel(reqId: string): Promise<{ ok: boolean }>;
  onAiChatChunk(reqId: string, handler: (chunk: string) => void): () => void;
  onAiChatDone(reqId: string, handler: (r: { ok: boolean; error?: string }) => void): () => void;
  searchStart(reqId: string, args: SearchArgs): Promise<{ ok: boolean; error?: string }>;
  searchCancel(reqId: string): Promise<{ ok: boolean }>;
  onSearchMatch(reqId: string, handler: (m: SearchMatch) => void): () => void;
  onSearchDone(
    reqId: string,
    handler: (r: { ok: boolean; error?: string; exitCode?: number | null }) => void,
  ): () => void;
  httpRequest(req: HttpRequestArgs): Promise<HttpResponseInfo>;
  chatHistoryList(): Promise<ChatHistoryEntry[]>;
  chatHistorySave(id: string, data: unknown): Promise<{ ok: boolean }>;
  chatHistoryLoad(id: string): Promise<string | null>;
  chatHistoryDelete(id: string): Promise<{ ok: boolean }>;
  gitApplyPatch(repoDir: string, patch: string, opts: { cached?: boolean; reverse?: boolean }): Promise<{ ok: boolean; error?: string }>;
  gitLog(repoDir: string, opts?: { limit?: number; ref?: string }): Promise<{ ok: boolean; commits?: GitLogEntry[]; error?: string }>;
  gitShow(repoDir: string, hash: string): Promise<{ ok: boolean; diff?: string; error?: string }>;
  gitCherryPick(repoDir: string, hash: string): Promise<{ ok: boolean; error?: string }>;
  gitTags(repoDir: string): Promise<{ ok: boolean; tags?: string[]; error?: string }>;
  gitCreateTag(repoDir: string, name: string, message: string): Promise<{ ok: boolean; error?: string }>;
  gitDeleteTag(repoDir: string, name: string): Promise<{ ok: boolean; error?: string }>;
  onMenu(channel: string, handler: () => void): () => void;

  ptySpawn(id: string, opts: { cwd?: string; cols?: number; rows?: number }): Promise<{ ok: boolean; error?: string }>;
  ptyWrite(id: string, data: string): Promise<boolean>;
  ptyResize(id: string, cols: number, rows: number): Promise<boolean>;
  ptyKill(id: string): Promise<boolean>;
  onPtyData(id: string, handler: (data: string) => void): () => void;
  onPtyExit(id: string, handler: (exitCode: number) => void): () => void;
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

