import { useEffect, useState } from 'react';
import { useWorkspace, workspace, getActiveSession, getAllLeaves } from './state/workspace';
import { Sidebar } from './components/Sidebar';
import { PaneNode } from './components/PaneNode';
import { Outline } from './components/Outline';
import { FilePalette } from './components/FilePalette';
import { NewFilePicker } from './components/NewFilePicker';
import { PathInput } from './components/PathInput';
import { SessionStrip } from './components/SessionStrip';
import { NowPlaying } from './components/NowPlaying';
import { saveActive, saveActiveAs, openFileViaDialog, openFolderViaDialog, closeActiveTab, openTerminalTab, openProcessTab, openSearchTab, openClipboardTab, openSettingsTab, openShortcutsTab } from './lib/actions';
import { uiBus } from './lib/uiBus';
import { resetWorkspaceAndReload } from './lib/persistence';
import { runLauncherAction } from './lib/runLauncherAction';

// One modal at a time. Opening any modal automatically closes the others.
type Modal =
  | null
  | { kind: 'palette'; replace: boolean }
  | { kind: 'path'; replace: boolean }
  | { kind: 'newFile' };

/** Activate the Nth tab in the currently-focused leaf. `idx === -1` means
 *  the last tab. Out-of-range indexes silently no-op (Chrome behavior). */
function gotoTabInFocused(idx: number) {
  const leaf = workspace.getFocusedLeaf();
  if (!leaf || leaf.tabIds.length === 0) return;
  const target = idx < 0 ? leaf.tabIds[leaf.tabIds.length - 1] : leaf.tabIds[idx];
  if (!target) return;
  workspace.setActiveTab(target);
  workspace.requestEditorFocus();
}

export function App() {
  const sidebarVisible = useWorkspace((s) => getActiveSession(s).sidebarVisible);
  const outlineVisible = useWorkspace((s) => getActiveSession(s).outlineVisible);
  const rootDir = useWorkspace((s) => getActiveSession(s).rootDir);
  const sessions = useWorkspace((s) => s.sessions);
  const activeSessionId = useWorkspace((s) => s.activeSessionId);
  const [modal, setModal] = useState<Modal>(null);
  const close = () => setModal(null);

  useEffect(() => {
    if (rootDir != null) return;
    let cancelled = false;
    (async () => {
      // Try the last-opened workspace first; fall back to home dir if it's
      // gone or unreadable.
      let chosen: string | null = null;
      try {
        const saved = localStorage.getItem('marko:lastWorkspace');
        if (saved) {
          const st = await window.marko.stat(saved);
          if (st.exists && st.isDirectory) chosen = saved;
        }
      } catch {
        // ignore
      }
      if (!chosen) chosen = await window.marko.homeDir();
      if (!cancelled && getActiveSession().rootDir == null) {
        workspace.setRootDir(chosen);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootDir]);

  useEffect(() => {
    const offs = [
      // Launcher (global hotkey window) dispatches actions back here.
      window.marko.onLauncherRun((action) => {
        console.log('[marko] onLauncherRun fired with action:', action);
        void runLauncherAction(action as Parameters<typeof runLauncherAction>[0]);
      }),
      uiBus.on('open-palette', () => setModal({ kind: 'palette', replace: false })),
      uiBus.on('open-settings', () => openSettingsTab()),
      uiBus.on('open-process-viewer', () => openProcessTab()),
      uiBus.on('open-new-file', () => setModal({ kind: 'newFile' })),
      uiBus.on('open-path', () => setModal({ kind: 'path', replace: false })),
      uiBus.on('open-shortcuts', () => openShortcutsTab()),
      window.marko.onMenu('menu:new', () => setModal({ kind: 'newFile' })),
      window.marko.onMenu('menu:open-file', () => void openFileViaDialog()),
      window.marko.onMenu('menu:open-folder', () => void openFolderViaDialog()),
      window.marko.onMenu('menu:save', () => void saveActive()),
      window.marko.onMenu('menu:save-as', () => void saveActiveAs()),
      window.marko.onMenu('menu:close-tab', () => closeActiveTab()),
      window.marko.onMenu('menu:prev-tab', () => workspace.cycleTab(-1)),
      window.marko.onMenu('menu:next-tab', () => workspace.cycleTab(1)),
      // ⌘1-8 = activate Nth tab in focused leaf; ⌘9 = activate last tab.
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
        window.marko.onMenu(`menu:goto-tab-${n}`, () => gotoTabInFocused(n - 1)),
      ),
      window.marko.onMenu('menu:goto-tab-last', () => gotoTabInFocused(-1)),
      window.marko.onMenu('menu:toggle-sidebar', () => workspace.toggleSidebar()),
      window.marko.onMenu('menu:toggle-outline', () => workspace.toggleOutline()),
      window.marko.onMenu('menu:toggle-markdown-mode', () => workspace.toggleMarkdownViewMode()),
      window.marko.onMenu('menu:preferences', () => openSettingsTab()),
      window.marko.onMenu('menu:find-in-files', () => {
        // Reuse an existing Search tab in the active session if one exists,
        // otherwise open a new one.
        const s = workspace.getState();
        const session = getActiveSession(s);
        const leaves = getAllLeaves(session.root);
        for (const leaf of leaves) {
          for (const id of leaf.tabIds) {
            const tab = s.tabs.find((t) => t.id === id);
            if (tab?.kind === 'search') {
              workspace.revealTab(tab.id);
              return;
            }
          }
        }
        openSearchTab();
      }),
      window.marko.onMenu('menu:quick-open', () => setModal({ kind: 'palette', replace: false })),
      window.marko.onMenu('menu:quick-open-replace', () => setModal({ kind: 'palette', replace: true })),
      window.marko.onMenu('menu:goto-path', () => setModal({ kind: 'path', replace: false })),
      window.marko.onMenu('menu:goto-path-replace', () => setModal({ kind: 'path', replace: true })),
      window.marko.onMenu('menu:new-terminal', () => openTerminalTab()),
      window.marko.onMenu('menu:focus-address', () => uiBus.emit('focus-address')),
      window.marko.onMenu('menu:process-viewer', () => openProcessTab()),
      window.marko.onMenu('menu:open-clipboard', () => openClipboardTab()),
      window.marko.onMenu('menu:show-shortcuts', () => openShortcutsTab()),
      window.marko.onMenu('menu:split-right', () => workspace.splitFocused('horizontal')),
      window.marko.onMenu('menu:split-down', () => workspace.splitFocused('vertical')),
      window.marko.onMenu('menu:close-pane', () => workspace.closePane(workspace.getFocusedLeaf().id)),
      window.marko.onMenu('menu:cycle-layout', () => workspace.cycleLayout()),
      window.marko.onMenu('menu:new-session', () => workspace.newSession()),
      window.marko.onMenu('menu:close-session', () => {
        const id = workspace.getState().activeSessionId;
        workspace.closeSession(id);
      }),
      window.marko.onMenu('menu:next-session', () => workspace.cycleSession(1)),
      window.marko.onMenu('menu:prev-session', () => workspace.cycleSession(-1)),
      window.marko.onMenu('menu:reset-workspace', () => {
        const ok = window.confirm(
          'Reset workspace?\n\nThis closes all open tabs and removes every session. ' +
            'Your saved files, settings, and recent-files list are NOT touched.',
        );
        if (ok) void resetWorkspaceAndReload();
      }),
      window.marko.onMenu('menu:focus-pane-next', () => {
        const s = workspace.getState();
        const session = getActiveSession(s);
        const leaves = getAllLeaves(session.root);
        if (leaves.length < 2) return;
        const idx = leaves.findIndex((l) => l.id === session.focusedLeafId);
        const next = (idx + 1) % leaves.length;
        workspace.setFocusedPane(leaves[next].id);
      }),
      window.marko.onMenu('menu:focus-pane-prev', () => {
        const s = workspace.getState();
        const session = getActiveSession(s);
        const leaves = getAllLeaves(session.root);
        if (leaves.length < 2) return;
        const idx = leaves.findIndex((l) => l.id === session.focusedLeafId);
        const prev = (idx - 1 + leaves.length) % leaves.length;
        workspace.setFocusedPane(leaves[prev].id);
      }),
    ];
    return () => {
      offs.forEach((off) => off());
    };
  }, []);

  return (
    <div className="app">
      <div className="titlebar">
        <SessionStrip />
        <NowPlaying />
      </div>
      <div className="app-body">
        <aside className={`sidebar ${sidebarVisible ? '' : 'sidebar--hidden'}`}>
          <Sidebar />
        </aside>
        <div className="panes">
          {sessions.map((session) => {
            const multi = getAllLeaves(session.root).length > 1;
            return (
              <div
                key={session.id}
                className={`session-stack${multi ? ' session-stack--multi' : ''}`}
                data-session-id={session.id}
                style={{ display: session.id === activeSessionId ? 'flex' : 'none' }}
              >
                <PaneNode node={session.root} sessionId={session.id} />
              </div>
            );
          })}
        </div>
        {outlineVisible && (
          <aside className="outline">
            <Outline />
          </aside>
        )}
      </div>
      <FilePalette
        open={modal?.kind === 'palette'}
        replace={modal?.kind === 'palette' ? modal.replace : false}
        onClose={close}
      />
      <NewFilePicker open={modal?.kind === 'newFile'} onClose={close} />
      <PathInput
        open={modal?.kind === 'path'}
        replace={modal?.kind === 'path' ? modal.replace : false}
        onClose={close}
      />
    </div>
  );
}
