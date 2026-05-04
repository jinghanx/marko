import type { LauncherAction } from '../shared/launcherActions';
import { LAUNCHER_COMMANDS } from '../shared/launcherActions';
import {
  openTerminalTab,
  openProcessTab,
  openGitTab,
  openExcalidrawTab,
  openChatTab,
  openSearchTab,
  openHttpTab,
  openClipboardTab,
  openSettingsTab,
  openShortcutsTab,
  openMusicTab,
  openLaterTab,
  openFileFromPath,
  openFolderInEditor,
  openUrlInTab,
} from './actions';
import { settings, buildSearchUrl } from '../state/settings';

async function openHomeFolder(sub: string): Promise<void> {
  const home = await window.marko.homeDir();
  const full = sub ? `${home}/${sub}` : home;
  await openFolderInEditor(full, { focus: true });
}

/** Bump the launcher-command usage timestamp for whichever
 *  LAUNCHER_COMMAND this action came from. Used by the empty-query
 *  ranker so frequently-used commands bubble up over time. Dynamic
 *  actions (open-app, web-search) don't correspond to a fixed
 *  command — they fall through silently. */
function recordCommandUsage(action: LauncherAction): void {
  const matching = LAUNCHER_COMMANDS.find((c) => {
    if (c.action.type !== action.type) return false;
    // Disambiguate args for actions that share a type across commands.
    if (c.action.type === 'open-folder' && action.type === 'open-folder') {
      return c.action.path === action.path;
    }
    if (c.action.type === 'open-home-folder' && action.type === 'open-home-folder') {
      return c.action.sub === action.sub;
    }
    return true;
  });
  if (matching) settings.bumpCommandUsage(matching.keywords[0]);
}

/** Dispatcher for actions arriving from either the in-window ⌘T palette or
 *  the global launcher window. Keep this side-effect-only and synchronous
 *  enough to be safe in keyboard-flow contexts. */
export async function runLauncherAction(action: LauncherAction): Promise<void> {
  recordCommandUsage(action);
  switch (action.type) {
    case 'show-marko':
      // No-op in the renderer — main has already done mainWindow.show()
      // and mainWindow.focus() before forwarding the action. The
      // dispatch case exists only so the switch is exhaustive.
      return;
    case 'open-terminal':
      openTerminalTab();
      return;
    case 'open-chat':
      openChatTab();
      return;
    case 'open-search':
      openSearchTab();
      return;
    case 'open-git':
      openGitTab();
      return;
    case 'open-http':
      openHttpTab();
      return;
    case 'open-excalidraw':
      openExcalidrawTab();
      return;
    case 'open-clipboard':
      openClipboardTab();
      return;
    case 'open-settings':
      openSettingsTab();
      return;
    case 'open-shortcuts':
      openShortcutsTab();
      return;
    case 'open-process':
      openProcessTab();
      return;
    case 'open-music':
      openMusicTab();
      return;
    case 'open-later':
      openLaterTab();
      return;
    case 'open-notes': {
      const file = await window.marko.notesPath();
      await openFileFromPath(file, { focus: true });
      return;
    }
    case 'open-folder':
      await openFolderInEditor(action.path, { focus: true });
      return;
    case 'open-home-folder':
      await openHomeFolder(action.sub);
      return;
    case 'open-app':
      await window.marko.openDefault(action.appPath);
      return;
    case 'web-search': {
      console.log('[marko] web-search action received, query:', action.query);
      const { url } = buildSearchUrl(settings.get(), action.query);
      console.log('[marko] built search url:', url);
      openUrlInTab(url);
      console.log('[marko] openUrlInTab called');
      return;
    }
  }
}
