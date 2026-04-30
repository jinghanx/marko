import { useMemo } from 'react';
import { useWorkspace, findLeaf, type Tab } from '../state/workspace';
import { CrepeEditor } from './CrepeEditor';
import { CodeEditor } from './CodeEditor';
import { ImageViewer } from './ImageViewer';
import { FolderView } from './FolderView';
import { WebView } from './WebView';
import { Terminal } from './Terminal';
import { WelcomeScreen } from './WelcomeScreen';

interface EditorPaneProps {
  paneId: string;
}

export function EditorPane({ paneId }: EditorPaneProps) {
  const allTabs = useWorkspace((s) => s.tabs);
  const leaf = useWorkspace((s) => findLeaf(s.root, paneId));
  const tabs = useMemo(() => {
    if (!leaf) return [];
    const map = new Map(allTabs.map((t) => [t.id, t]));
    return leaf.tabIds.map((id) => map.get(id)).filter((t): t is Tab => !!t);
  }, [leaf, allTabs]);
  const activeTabId = leaf?.activeTabId ?? null;

  if (tabs.length === 0) {
    return (
      <div className="editor-pane editor-pane--empty">
        <WelcomeScreen />
      </div>
    );
  }

  return (
    <div className="editor-pane">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="editor-host"
          style={{ display: tab.id === activeTabId ? 'block' : 'none' }}
        >
          {tab.kind === 'markdown' && (
            <CrepeEditor tabId={tab.id} initialValue={tab.savedContent} />
          )}
          {tab.kind === 'code' && (
            <CodeEditor
              tabId={tab.id}
              initialValue={tab.savedContent}
              filePath={tab.filePath}
              language={tab.language}
            />
          )}
          {tab.kind === 'image' && (
            <ImageViewer src={tab.savedContent} filePath={tab.filePath} title={tab.title} />
          )}
          {tab.kind === 'folder' && tab.filePath && (
            <FolderView folderPath={tab.filePath} tabId={tab.id} />
          )}
          {tab.kind === 'web' && tab.filePath && (
            <WebView tabId={tab.id} url={tab.filePath} />
          )}
          {tab.kind === 'terminal' && <Terminal tabId={tab.id} />}
          {tab.kind === 'binary' && (
            <div className="binary-hint">
              <div className="binary-icon">⌬</div>
              <div className="binary-title">Can't open this file</div>
              <div className="binary-subtitle">
                Binary files (images, PDFs, archives, etc.) aren't editable here.
              </div>
              {tab.filePath && <div className="binary-path">{tab.filePath}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
