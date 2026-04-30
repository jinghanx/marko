import { useEffect, useState } from 'react';
import { useWorkspace, workspace, getAllLeaves } from './state/workspace';
import { Sidebar } from './components/Sidebar';
import { PaneNode } from './components/PaneNode';
import { Outline } from './components/Outline';
import { SettingsModal } from './components/SettingsModal';
import { FilePalette } from './components/FilePalette';
import { ProcessViewer } from './components/ProcessViewer';
import { NewFilePicker } from './components/NewFilePicker';
import { PathInput } from './components/PathInput';
import { saveActive, saveActiveAs, openFileViaDialog, openFolderViaDialog, closeActiveTab, openTerminalTab } from './lib/actions';
import { uiBus } from './lib/uiBus';

// One modal at a time. Opening any modal automatically closes the others.
type Modal =
  | null
  | { kind: 'palette'; replace: boolean }
  | { kind: 'path'; replace: boolean }
  | { kind: 'settings' }
  | { kind: 'procViewer' }
  | { kind: 'newFile' };

export function App() {
  const sidebarVisible = useWorkspace((s) => s.sidebarVisible);
  const outlineVisible = useWorkspace((s) => s.outlineVisible);
  const rootDir = useWorkspace((s) => s.rootDir);
  const root = useWorkspace((s) => s.root);
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
      if (!cancelled && workspace.getState().rootDir == null) {
        workspace.setRootDir(chosen);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootDir]);

  useEffect(() => {
    const offs = [
      uiBus.on('open-palette', () => setModal({ kind: 'palette', replace: false })),
      uiBus.on('open-settings', () => setModal({ kind: 'settings' })),
      uiBus.on('open-process-viewer', () => setModal({ kind: 'procViewer' })),
      uiBus.on('open-new-file', () => setModal({ kind: 'newFile' })),
      window.marko.onMenu('menu:new', () => setModal({ kind: 'newFile' })),
      window.marko.onMenu('menu:open-file', () => void openFileViaDialog()),
      window.marko.onMenu('menu:open-folder', () => void openFolderViaDialog()),
      window.marko.onMenu('menu:save', () => void saveActive()),
      window.marko.onMenu('menu:save-as', () => void saveActiveAs()),
      window.marko.onMenu('menu:close-tab', () => closeActiveTab()),
      window.marko.onMenu('menu:prev-tab', () => workspace.cycleTab(-1)),
      window.marko.onMenu('menu:next-tab', () => workspace.cycleTab(1)),
      window.marko.onMenu('menu:toggle-sidebar', () => workspace.toggleSidebar()),
      window.marko.onMenu('menu:toggle-outline', () => workspace.toggleOutline()),
      window.marko.onMenu('menu:toggle-markdown-mode', () => workspace.toggleMarkdownViewMode()),
      window.marko.onMenu('menu:preferences', () => setModal({ kind: 'settings' })),
      window.marko.onMenu('menu:quick-open', () => setModal({ kind: 'palette', replace: false })),
      window.marko.onMenu('menu:quick-open-replace', () => setModal({ kind: 'palette', replace: true })),
      window.marko.onMenu('menu:goto-path', () => setModal({ kind: 'path', replace: false })),
      window.marko.onMenu('menu:goto-path-replace', () => setModal({ kind: 'path', replace: true })),
      window.marko.onMenu('menu:new-terminal', () => openTerminalTab()),
      window.marko.onMenu('menu:focus-address', () => uiBus.emit('focus-address')),
      window.marko.onMenu('menu:process-viewer', () => setModal({ kind: 'procViewer' })),
      window.marko.onMenu('menu:split-right', () => workspace.splitFocused('horizontal')),
      window.marko.onMenu('menu:split-down', () => workspace.splitFocused('vertical')),
      window.marko.onMenu('menu:close-pane', () => workspace.closePane(workspace.getState().focusedLeafId)),
      window.marko.onMenu('menu:cycle-layout', () => workspace.cycleLayout()),
      window.marko.onMenu('menu:focus-pane-next', () => {
        const s = workspace.getState();
        const leaves = getAllLeaves(s.root);
        if (leaves.length < 2) return;
        const idx = leaves.findIndex((l) => l.id === s.focusedLeafId);
        const next = (idx + 1) % leaves.length;
        workspace.setFocusedPane(leaves[next].id);
      }),
      window.marko.onMenu('menu:focus-pane-prev', () => {
        const s = workspace.getState();
        const leaves = getAllLeaves(s.root);
        if (leaves.length < 2) return;
        const idx = leaves.findIndex((l) => l.id === s.focusedLeafId);
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
      <div className="titlebar" />
      <div className="app-body">
        <aside className={`sidebar ${sidebarVisible ? '' : 'sidebar--hidden'}`}>
          <Sidebar />
        </aside>
        <div className="panes">
          <PaneNode node={root} />
        </div>
        {outlineVisible && (
          <aside className="outline">
            <Outline />
          </aside>
        )}
      </div>
      <SettingsModal open={modal?.kind === 'settings'} onClose={close} />
      <FilePalette
        open={modal?.kind === 'palette'}
        replace={modal?.kind === 'palette' ? modal.replace : false}
        onClose={close}
      />
      <ProcessViewer open={modal?.kind === 'procViewer'} onClose={close} />
      <NewFilePicker open={modal?.kind === 'newFile'} onClose={close} />
      <PathInput
        open={modal?.kind === 'path'}
        replace={modal?.kind === 'path' ? modal.replace : false}
        onClose={close}
      />
    </div>
  );
}
