import { workspace } from '../state/workspace';
import { openFileViaDialog, openFolderViaDialog, openTerminalTab } from '../lib/actions';
import { uiBus } from '../lib/uiBus';

const LOGO = String.raw`
   ███╗   ███╗  █████╗  ██████╗  ██╗  ██╗  ██████╗
   ████╗ ████║ ██╔══██╗ ██╔══██╗ ██║ ██╔╝ ██╔═══██╗
   ██╔████╔██║ ███████║ ██████╔╝ █████╔╝  ██║   ██║
   ██║╚██╔╝██║ ██╔══██║ ██╔══██╗ ██╔═██╗  ██║   ██║
   ██║ ╚═╝ ██║ ██║  ██║ ██║  ██║ ██║  ██╗ ╚██████╔╝
   ╚═╝     ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝  ╚═════╝
`;

const TAGLINE = '> editor ✦ finder ✦ browser ✦ terminal — one window for everything';

interface Shortcut {
  keys: string;
  label: string;
  run?: () => void;
}

interface Section {
  title: string;
  items: Shortcut[];
}

const SECTIONS: Section[] = [
  {
    title: 'Files',
    items: [
      { keys: '⌘N', label: 'new file…', run: () => uiBus.emit('open-new-file') },
      { keys: '⌘O', label: 'open file…', run: () => void openFileViaDialog() },
      { keys: '⌘⇧O', label: 'open folder…', run: () => void openFolderViaDialog() },
      { keys: '⌘P', label: 'quick open', run: () => uiBus.emit('open-palette') },
      { keys: '⌘⇧P', label: 'quick open (replace)' },
      { keys: '⌘T', label: 'go to path / command' },
      { keys: '⌘⇧T', label: 'go to path (replace)' },
      { keys: '⌘S', label: 'save' },
      { keys: '⌘⇧S', label: 'save as…' },
    ],
  },
  {
    title: 'Tabs',
    items: [
      { keys: '⌘W', label: 'close tab' },
      { keys: '⌘⇧W', label: 'close window' },
      { keys: '⌘⇧[', label: 'previous tab' },
      { keys: '⌘⇧]', label: 'next tab' },
    ],
  },
  {
    title: 'Panes',
    items: [
      { keys: '⌘\\', label: 'split right', run: () => workspace.splitFocused('horizontal') },
      { keys: '⌘=', label: 'split down', run: () => workspace.splitFocused('vertical') },
      { keys: '⌘⌥W', label: 'close pane' },
      { keys: '⌘⇧␣', label: 'cycle layouts' },
      { keys: '⌘`', label: 'next pane' },
      { keys: '⌘⇧`', label: 'previous pane' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: '⌘E', label: 'toggle sidebar', run: () => workspace.toggleSidebar() },
      { keys: '⌘⇧\\', label: 'toggle outline', run: () => workspace.toggleOutline() },
      { keys: '⌘⇧M', label: 'toggle md raw / rendered', run: () => workspace.toggleMarkdownViewMode() },
      { keys: '⌘L', label: 'focus web address bar' },
      { keys: '⌘Y', label: 'process viewer', run: () => uiBus.emit('open-process-viewer') },
      { keys: '⌘,', label: 'preferences', run: () => uiBus.emit('open-settings') },
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
    title: 'Tip',
    items: [
      { keys: '⌘T', label: 'type a path, URL, or "terminal"', run: () => openTerminalTab() },
    ],
  },
];

export function WelcomeScreen() {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <pre className="welcome-logo" aria-label="MARKO">
          {LOGO}
        </pre>
        <div className="welcome-tagline">{TAGLINE}</div>

        <div className="welcome-grid">
          {SECTIONS.map((section) => (
            <div key={section.title} className="welcome-section">
              <div className="welcome-section-title">{section.title}</div>
              {section.items.map((item) => (
                <div
                  key={item.keys + item.label}
                  className={`welcome-row ${item.run ? 'welcome-row--actionable' : ''}`}
                  onClick={item.run}
                >
                  <span className="welcome-keys">{item.keys}</span>
                  <span className="welcome-label">{item.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="welcome-blink">
          <span className="welcome-prompt">$</span> ready_<span className="welcome-cursor" />
        </div>
      </div>
    </div>
  );
}
