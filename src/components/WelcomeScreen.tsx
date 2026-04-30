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

const TAGLINE = '> markdown for hackers ✦ wysiwyg editor ✦ dotfile-friendly';

interface Action {
  keys: string;
  label: string;
  run: () => void;
}

const actions: Action[] = [
  { keys: '⌘N', label: 'new file', run: () => uiBus.emit('open-new-file') },
  { keys: '⌘O', label: 'open file', run: () => void openFileViaDialog() },
  { keys: '⌘⇧O', label: 'open folder', run: () => void openFolderViaDialog() },
  { keys: '⌘P', label: 'quick open', run: () => uiBus.emit('open-palette') },
  { keys: '⌘,', label: 'preferences', run: () => uiBus.emit('open-settings') },
  { keys: '⌘Y', label: 'process viewer', run: () => uiBus.emit('open-process-viewer') },
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
          {actions.map((a) => (
            <button key={a.keys} className="welcome-action" onClick={a.run}>
              <span className="welcome-keys">{a.keys}</span>
              <span className="welcome-arrow">▸</span>
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
