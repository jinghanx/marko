import { uiBus } from '../lib/uiBus';
import { settings } from '../state/settings';

interface QuickAction {
  keys: string;
  label: string;
  run: () => void;
}

const ACTIONS: QuickAction[] = [
  { keys: '⌘P', label: 'quick-open any file', run: () => uiBus.emit('open-palette') },
  { keys: '⌘T', label: 'go to path / run command', run: () => uiBus.emit('open-path') },
];

export function WelcomeScreen() {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-actions">
          {ACTIONS.map((a) => (
            <button key={a.keys} className="welcome-row welcome-row--actionable" onClick={a.run}>
              <span className="welcome-keys">{a.keys}</span>
              <span className="welcome-label">{a.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="welcome-tour"
          onClick={() => settings.update({ hasSeenOnboarding: false })}
        >
          Take the tour →
        </button>
      </div>
    </div>
  );
}
