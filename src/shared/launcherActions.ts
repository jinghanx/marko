/** Serializable action types that both the main palette (⌘T) and the
 *  global launcher window dispatch. Keep these JSON-safe — they cross the
 *  IPC boundary from the launcher renderer to main and back into the main
 *  window's renderer, so no functions or DOM references. */

export type LauncherAction =
  | { type: 'open-terminal' }
  | { type: 'open-chat' }
  | { type: 'open-search' }
  | { type: 'open-git' }
  | { type: 'open-http' }
  | { type: 'open-excalidraw' }
  | { type: 'open-clipboard' }
  | { type: 'open-settings' }
  | { type: 'open-process' }
  | { type: 'open-notes' }
  | { type: 'open-shortcuts' }
  | { type: 'open-folder'; path: string }
  | { type: 'open-home-folder'; sub: string }
  | { type: 'open-app'; appPath: string }
  | { type: 'web-search'; query: string };

/** Subset of tab kinds — any kind that's reachable from a launcher
 *  command. Defined as a string union here (not imported from
 *  state/workspace) so this module stays decoupled from the renderer. */
export type LauncherIconKind =
  | 'terminal'
  | 'chat'
  | 'search'
  | 'git'
  | 'http'
  | 'excalidraw'
  | 'clipboard'
  | 'settings'
  | 'process'
  | 'markdown'
  | 'folder'
  | 'code';

export interface LauncherCommand {
  /** First keyword is the canonical name; rest are aliases. */
  keywords: string[];
  label: string;
  /** Short tag rendered as a category label in the suggestion row. */
  category: string;
  /** Tab-kind icon to render — matches the icon used on the actual tab
   *  once the command runs (e.g., terminal command → terminal glyph). */
  iconKind: LauncherIconKind;
  action: LauncherAction;
}

export const LAUNCHER_COMMANDS: LauncherCommand[] = [
  {
    keywords: ['terminal', 'term', 'shell', 'tty'],
    label: 'Open Terminal',
    category: 'Terminal',
    iconKind: 'terminal',
    action: { type: 'open-terminal' },
  },
  {
    keywords: ['chat', 'ai', 'assistant', 'gpt', 'llm'],
    label: 'Open AI Chat',
    category: 'AI',
    iconKind: 'chat',
    action: { type: 'open-chat' },
  },
  {
    keywords: ['search', 'find', 'grep', 'rg'],
    label: 'Find in Files (ripgrep)',
    category: 'Search',
    iconKind: 'search',
    action: { type: 'open-search' },
  },
  {
    keywords: ['git', 'status', 'commit'],
    label: 'Open Git (status / stage / commit)',
    category: 'Git',
    iconKind: 'git',
    action: { type: 'open-git' },
  },
  {
    keywords: ['http', 'request', 'rest', 'api', 'curl', 'postman'],
    label: 'Open HTTP Client',
    category: 'HTTP',
    iconKind: 'http',
    action: { type: 'open-http' },
  },
  {
    keywords: ['whiteboard', 'draw', 'excalidraw', 'sketch', 'canvas'],
    label: 'Open Whiteboard (Excalidraw)',
    category: 'Whiteboard',
    iconKind: 'excalidraw',
    action: { type: 'open-excalidraw' },
  },
  {
    keywords: ['clipboard', 'pasteboard', 'paste', 'clip'],
    label: 'Open Clipboard History',
    category: 'Clipboard',
    iconKind: 'clipboard',
    action: { type: 'open-clipboard' },
  },
  {
    keywords: ['settings', 'preferences', 'prefs', 'config', 'theme'],
    label: 'Open Settings',
    category: 'Settings',
    iconKind: 'settings',
    action: { type: 'open-settings' },
  },
  {
    keywords: ['shortcuts', 'keys', 'hotkeys', 'keymap'],
    label: 'Open Keyboard Shortcuts',
    category: 'Help',
    iconKind: 'code',
    action: { type: 'open-shortcuts' },
  },
  {
    keywords: ['activity', 'processes', 'process', 'top', 'htop'],
    label: 'Open Activity (process viewer)',
    category: 'Activity',
    iconKind: 'process',
    action: { type: 'open-process' },
  },
  {
    keywords: ['notes', 'note', 'scratchpad'],
    label: 'Open Notes (~/.marko/notes.txt)',
    category: 'Notes',
    iconKind: 'markdown',
    action: { type: 'open-notes' },
  },
  {
    keywords: ['downloads', 'dl'],
    label: 'Open ~/Downloads',
    category: 'Folder',
    iconKind: 'folder',
    action: { type: 'open-home-folder', sub: 'Downloads' },
  },
  {
    keywords: ['documents', 'docs'],
    label: 'Open ~/Documents',
    category: 'Folder',
    iconKind: 'folder',
    action: { type: 'open-home-folder', sub: 'Documents' },
  },
  {
    keywords: ['desktop'],
    label: 'Open ~/Desktop',
    category: 'Folder',
    iconKind: 'folder',
    action: { type: 'open-home-folder', sub: 'Desktop' },
  },
  {
    keywords: ['home', '~'],
    label: 'Open ~ (home)',
    category: 'Folder',
    iconKind: 'folder',
    action: { type: 'open-home-folder', sub: '' },
  },
  {
    keywords: ['applications', 'apps'],
    label: 'Open /Applications',
    category: 'Folder',
    iconKind: 'folder',
    action: { type: 'open-folder', path: '/Applications' },
  },
];
