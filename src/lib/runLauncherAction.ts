import type { LauncherAction } from '../shared/launcherActions';
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

/** Dispatcher for actions arriving from either the in-window ⌘T palette or
 *  the global launcher window. Keep this side-effect-only and synchronous
 *  enough to be safe in keyboard-flow contexts. */
export async function runLauncherAction(action: LauncherAction): Promise<void> {
  switch (action.type) {
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
