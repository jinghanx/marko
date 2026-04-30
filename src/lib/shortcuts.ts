/** Shared keyboard-shortcut catalog used by the welcome screen and the
 *  ⌘⇧/ "all shortcuts" modal. */

export interface Shortcut {
  keys: string;
  label: string;
}

export interface ShortcutSection {
  title: string;
  items: Shortcut[];
}

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'Files',
    items: [
      { keys: '⌘N', label: 'new file…' },
      { keys: '⌘O', label: 'open file…' },
      { keys: '⌘⇧O', label: 'open folder…' },
      { keys: '⌘P', label: 'quick open' },
      { keys: '⌘⇧P', label: 'quick open (replace tab)' },
      { keys: '⌘T', label: 'go to path / command' },
      { keys: '⌘⇧T', label: 'go to path (replace tab)' },
      { keys: '⌘S', label: 'save' },
      { keys: '⌘⇧S', label: 'save as…' },
    ],
  },
  {
    title: 'Tabs',
    items: [
      { keys: '⌘W', label: 'close tab' },
      { keys: '⌘⇧[', label: 'previous tab' },
      { keys: '⌘⇧]', label: 'next tab' },
    ],
  },
  {
    title: 'Sessions',
    items: [
      { keys: '⌘⌥N', label: 'new session' },
      { keys: '⌘⇧W', label: 'close session' },
      { keys: '⌘⇧9', label: 'previous session' },
      { keys: '⌘⇧0', label: 'next session' },
    ],
  },
  {
    title: 'Panes',
    items: [
      { keys: '⌘\\', label: 'split right' },
      { keys: '⌘=', label: 'split down' },
      { keys: '⌘⌥W', label: 'close pane' },
      { keys: '⌘`', label: 'next pane' },
      { keys: '⌘⇧`', label: 'previous pane' },
      { keys: '⌘⇧␣', label: 'cycle layouts' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: '⌘E', label: 'toggle sidebar' },
      { keys: '⌘⇧\\', label: 'toggle outline' },
      { keys: '⌘⇧M', label: 'toggle md raw / rendered' },
      { keys: '⌘L', label: 'focus web address bar' },
      { keys: '⌘Y', label: 'process viewer' },
      { keys: '⌘,', label: 'preferences' },
      { keys: '⌘⇧/', label: 'show all shortcuts' },
      { keys: '⌘0', label: 'reset zoom' },
      { keys: '⌘⇧=', label: 'zoom in' },
      { keys: '⌘-', label: 'zoom out' },
    ],
  },
  {
    title: 'Folder View',
    items: [
      { keys: '↑↓←→', label: 'navigate' },
      { keys: '↵', label: 'open' },
      { keys: 'space', label: 'Quick Look' },
      { keys: '⌘A', label: 'select all' },
      { keys: '⌘C / ⌘X', label: 'copy / cut' },
      { keys: '⌘V', label: 'paste' },
      { keys: '⌘⌫', label: 'move to Trash' },
      { keys: '⌘[ / ⌘]', label: 'back / forward' },
    ],
  },
  {
    title: 'Sidebar Tree',
    items: [
      { keys: '↑↓', label: 'navigate' },
      { keys: '←→', label: 'collapse / expand' },
      { keys: 'F2', label: 'rename' },
      { keys: 'n / N', label: 'new file / folder' },
      { keys: '↵', label: 'open' },
      { keys: 'right-click', label: 'context menu' },
    ],
  },
  {
    title: 'Markdown / Command Palette',
    items: [
      { keys: '/', label: 'open block menu (in editor)' },
      { keys: 'Tab', label: 'autocomplete (in ⌘T)' },
      { keys: 'esc', label: 'close any modal' },
    ],
  },
];
