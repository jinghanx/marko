import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Launcher } from './Launcher';
import './launcher.css';

/** Read the user's chosen theme from the shared `marko:settings`
 *  localStorage blob. The main window writes this; the launcher
 *  reads it. 'system' is resolved against matchMedia so the launcher
 *  follows the OS only when the user explicitly opted into that. */
type ThemeMode = 'system' | 'light' | 'dark';
function readThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem('marko:settings');
    if (!raw) return 'system';
    const parsed = JSON.parse(raw) as { theme?: ThemeMode };
    return parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : 'system';
  } catch {
    return 'system';
  }
}

function effectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  const resolved = effectiveTheme(readThemeMode());
  document.documentElement.dataset.theme = resolved;
}

applyTheme();

// Re-apply when the main window persists a settings update — localStorage
// 'storage' events fire across windows of the same origin (they don't
// fire in the originating window, but that's fine; the launcher only
// listens for changes from main).
window.addEventListener('storage', (e) => {
  if (e.key === 'marko:settings') applyTheme();
});

// Also re-apply on system theme change while in 'system' mode.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (readThemeMode() === 'system') applyTheme();
});

createRoot(document.getElementById('launcher-root')!).render(
  <StrictMode>
    <Launcher />
  </StrictMode>,
);
