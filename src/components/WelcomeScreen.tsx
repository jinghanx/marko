import { openFileViaDialog, openFolderViaDialog } from '../lib/actions';
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

interface QuickAction {
  keys: string;
  label: string;
  run: () => void;
}

const ACTIONS: QuickAction[] = [
  { keys: '⌘N', label: 'new file', run: () => uiBus.emit('open-new-file') },
  { keys: '⌘O', label: 'open file', run: () => void openFileViaDialog() },
  { keys: '⌘⇧O', label: 'open folder', run: () => void openFolderViaDialog() },
  { keys: '⌘P', label: 'quick open', run: () => uiBus.emit('open-palette') },
  { keys: '⌘T', label: 'go to path / command', run: () => uiBus.emit('open-path') },
  { keys: '⌘⇧/', label: 'all shortcuts', run: () => uiBus.emit('open-shortcuts') },
];

export function WelcomeScreen() {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <pre className="welcome-logo" aria-label="MARKO">
          {LOGO}
        </pre>
        <div className="welcome-tagline">{TAGLINE}</div>

        <div className="welcome-actions">
          {ACTIONS.map((a) => (
            <button key={a.keys} className="welcome-row welcome-row--actionable" onClick={a.run}>
              <span className="welcome-keys">{a.keys}</span>
              <span className="welcome-label">{a.label}</span>
            </button>
          ))}
        </div>

        <div className="welcome-blink">
          <span className="welcome-prompt">$</span> ready_<span className="welcome-cursor" />
        </div>
      </div>
    </div>
  );
}
