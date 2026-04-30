import { useEffect, useState } from 'react';
import { useWorkspace, workspace } from './state/workspace';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { EditorPane } from './components/EditorPane';
import { Outline } from './components/Outline';
import { SettingsModal } from './components/SettingsModal';
import { FilePalette } from './components/FilePalette';
import { ProcessViewer } from './components/ProcessViewer';
import { NewFilePicker } from './components/NewFilePicker';
import { PathInput } from './components/PathInput';
import { saveActive, saveActiveAs, openFileViaDialog, openFolderViaDialog, closeActiveTab } from './lib/actions';
import { uiBus } from './lib/uiBus';

export function App() {
  const sidebarVisible = useWorkspace((s) => s.sidebarVisible);
  const outlineVisible = useWorkspace((s) => s.outlineVisible);
  const rootDir = useWorkspace((s) => s.rootDir);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [procViewerOpen, setProcViewerOpen] = useState(false);
  const [newFilePickerOpen, setNewFilePickerOpen] = useState(false);
  const [pathInputOpen, setPathInputOpen] = useState(false);

  useEffect(() => {
    if (rootDir != null) return;
    let cancelled = false;
    window.marko.homeDir().then((home) => {
      if (!cancelled && workspace.getState().rootDir == null) workspace.setRootDir(home);
    });
    return () => {
      cancelled = true;
    };
  }, [rootDir]);

  useEffect(() => {
    const offs = [
      uiBus.on('open-palette', () => setPaletteOpen(true)),
      uiBus.on('open-settings', () => setSettingsOpen(true)),
      uiBus.on('open-process-viewer', () => setProcViewerOpen(true)),
      uiBus.on('open-new-file', () => setNewFilePickerOpen(true)),
      window.marko.onMenu('menu:new', () => setNewFilePickerOpen(true)),
      window.marko.onMenu('menu:open-file', () => void openFileViaDialog()),
      window.marko.onMenu('menu:open-folder', () => void openFolderViaDialog()),
      window.marko.onMenu('menu:save', () => void saveActive()),
      window.marko.onMenu('menu:save-as', () => void saveActiveAs()),
      window.marko.onMenu('menu:close-tab', () => closeActiveTab()),
      window.marko.onMenu('menu:prev-tab', () => workspace.cycleTab(-1)),
      window.marko.onMenu('menu:next-tab', () => workspace.cycleTab(1)),
      window.marko.onMenu('menu:toggle-sidebar', () => workspace.toggleSidebar()),
      window.marko.onMenu('menu:toggle-outline', () => workspace.toggleOutline()),
      window.marko.onMenu('menu:preferences', () => setSettingsOpen(true)),
      window.marko.onMenu('menu:quick-open', () => setPaletteOpen(true)),
      window.marko.onMenu('menu:goto-path', () => setPathInputOpen(true)),
      window.marko.onMenu('menu:focus-address', () => uiBus.emit('focus-address')),
      window.marko.onMenu('menu:process-viewer', () => setProcViewerOpen(true)),
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
        <main className="main">
          <TabBar />
          <EditorPane />
        </main>
        {outlineVisible && (
          <aside className="outline">
            <Outline />
          </aside>
        )}
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <FilePalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ProcessViewer open={procViewerOpen} onClose={() => setProcViewerOpen(false)} />
      <NewFilePicker open={newFilePickerOpen} onClose={() => setNewFilePickerOpen(false)} />
      <PathInput open={pathInputOpen} onClose={() => setPathInputOpen(false)} />
    </div>
  );
}
