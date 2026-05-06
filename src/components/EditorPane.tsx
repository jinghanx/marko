import { lazy, Suspense, useMemo } from 'react';
import { useWorkspace, workspace, findLeaf, type Tab } from '../state/workspace';
// Common tab kinds stay eager — they're on the hot path (every workspace
// opens at least one of these on boot) and their bundles are modest.
import { CrepeEditor } from './CrepeEditor';
import { CodeEditor } from './CodeEditor';
import { ImageViewer } from './ImageViewer';
import { MediaViewer } from './MediaViewer';
import { FolderView } from './FolderView';
import { WebView } from './WebView';
import { Terminal } from './Terminal';
import { WelcomeScreen } from './WelcomeScreen';
// Specialty tab kinds load lazily so their bundles aren't part of the
// renderer's cold-start cost. Each is wrapped in <Suspense> below.
const PdfViewer = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })));
const CsvViewer = lazy(() => import('./CsvViewer').then((m) => ({ default: m.CsvViewer })));
const JsonViewer = lazy(() => import('./JsonViewer').then((m) => ({ default: m.JsonViewer })));
const DiffViewer = lazy(() => import('./DiffViewer').then((m) => ({ default: m.DiffViewer })));
const ExcalidrawViewer = lazy(() => import('./ExcalidrawViewer').then((m) => ({ default: m.ExcalidrawViewer })));
const ChatView = lazy(() => import('./ChatView').then((m) => ({ default: m.ChatView })));
const ClipboardView = lazy(() => import('./ClipboardView').then((m) => ({ default: m.ClipboardView })));
const SettingsView = lazy(() => import('./SettingsView').then((m) => ({ default: m.SettingsView })));
const ShortcutsView = lazy(() => import('./ShortcutsView').then((m) => ({ default: m.ShortcutsView })));
const SqliteView = lazy(() => import('./SqliteView').then((m) => ({ default: m.SqliteView })));
const SearchView = lazy(() => import('./SearchView').then((m) => ({ default: m.SearchView })));
const HttpClient = lazy(() => import('./HttpClient').then((m) => ({ default: m.HttpClient })));
const ProcessViewer = lazy(() => import('./ProcessViewer').then((m) => ({ default: m.ProcessViewer })));
const GitView = lazy(() => import('./GitView').then((m) => ({ default: m.GitView })));
const MusicView = lazy(() => import('./MusicView').then((m) => ({ default: m.MusicView })));
const LaterView = lazy(() => import('./LaterView').then((m) => ({ default: m.LaterView })));
const AgentView = lazy(() => import('./AgentView').then((m) => ({ default: m.AgentView })));
const DiffReviewView = lazy(() => import('./DiffReviewView').then((m) => ({ default: m.DiffReviewView })));
const MarkdownSplitView = lazy(() => import('./MarkdownSplitView').then((m) => ({ default: m.MarkdownSplitView })));
import { acpReviews } from '../state/acpReviews';
import { useSyncExternalStore } from 'react';

/** Placeholder shown while a lazy tab kind's bundle is fetching. Brief
 *  enough that the average opener won't notice; explicit enough that
 *  it doesn't look like a hang on slow disks / cold caches. */
function TabLoading() {
  return <div className="tab-loading" aria-label="Loading…" />;
}

interface EditorPaneProps {
  paneId: string;
  sessionId: string;
}

export function EditorPane({ paneId, sessionId }: EditorPaneProps) {
  const allTabs = useWorkspace((s) => s.tabs);
  const leaf = useWorkspace((s) => {
    const session = s.sessions.find((x) => x.id === sessionId);
    return session ? findLeaf(session.root, paneId) : null;
  });
  const tabs = useMemo(() => {
    if (!leaf) return [];
    const map = new Map(allTabs.map((t) => [t.id, t]));
    return leaf.tabIds.map((id) => map.get(id)).filter((t): t is Tab => !!t);
  }, [leaf, allTabs]);
  const activeTabId = leaf?.activeTabId ?? null;

  // Subscribe to the pending-review store once and look each tab up
  // by its filePath inline. Per-tab `useAcpReview` hooks would
  // violate the rules-of-hooks for reordered tabs.
  const reviewMap = useSyncExternalStore(
    acpReviews.subscribe,
    () => acpReviews.getState().byPath,
  );

  if (tabs.length === 0) {
    return (
      <div className="editor-pane editor-pane--empty">
        <WelcomeScreen />
      </div>
    );
  }

  return (
    <div className="editor-pane">
      {tabs.map((tab) => {
        // If an agent has proposed a write to this tab's file and the
        // user hasn't decided yet, the editor view is replaced with
        // the inline diff-review UI. Only kicks in for kinds that map
        // to a real text file (skip web/terminal/folder/etc.).
        const review =
          tab.filePath &&
          (tab.kind === 'markdown' ||
            tab.kind === 'code' ||
            tab.kind === 'json' ||
            tab.kind === 'csv' ||
            tab.kind === 'diff')
            ? reviewMap.get(tab.filePath)
            : undefined;
        return (
        <div
          key={tab.id}
          className="editor-host"
          style={{ display: tab.id === activeTabId ? 'block' : 'none' }}
        >
          <Suspense fallback={<TabLoading />}>
          {review && tab.filePath && (
            <DiffReviewView reviewId={review.id} filePath={tab.filePath} />
          )}
          {!review && tab.kind === 'markdown' && (
            <>
              <MarkdownModeToggle
                tabId={tab.id}
                mode={(tab.viewMode === 'tree' ? 'rendered' : tab.viewMode) ?? 'rendered'}
              />
              {(tab.viewMode ?? 'rendered') === 'rendered' && (
                <CrepeEditor key="rendered" tabId={tab.id} initialValue={tab.content} />
              )}
              {tab.viewMode === 'raw' && (
                <CodeEditor
                  key="raw"
                  tabId={tab.id}
                  initialValue={tab.content}
                  filePath={tab.filePath}
                  language="markdown"
                />
              )}
              {tab.viewMode === 'split' && (
                <MarkdownSplitView
                  key="split"
                  tabId={tab.id}
                  initialValue={tab.content}
                  filePath={tab.filePath}
                />
              )}
            </>
          )}
          {!review && tab.kind === 'code' && (
            <CodeEditor
              tabId={tab.id}
              initialValue={tab.content}
              filePath={tab.filePath}
              language={tab.language}
            />
          )}
          {tab.kind === 'image' && (
            <ImageViewer src={tab.savedContent} filePath={tab.filePath} title={tab.title} />
          )}
          {tab.kind === 'media' && tab.filePath && (
            <MediaViewer tabId={tab.id} filePath={tab.filePath} title={tab.title} />
          )}
          {tab.kind === 'pdf' && tab.filePath && (
            <PdfViewer filePath={tab.filePath} title={tab.title} />
          )}
          {!review && tab.kind === 'csv' && (
            <CsvViewer
              tabId={tab.id}
              filePath={tab.filePath}
              initialValue={tab.content}
            />
          )}
          {!review && tab.kind === 'json' && (
            <JsonViewer
              tabId={tab.id}
              filePath={tab.filePath}
              initialValue={tab.content}
            />
          )}
          {!review && tab.kind === 'diff' && tab.diffLeft && tab.diffRight && (
            <DiffViewer leftPath={tab.diffLeft} rightPath={tab.diffRight} />
          )}
          {tab.kind === 'excalidraw' && (
            <ExcalidrawViewer
              tabId={tab.id}
              initialValue={tab.content}
              filePath={tab.filePath}
            />
          )}
          {tab.kind === 'chat' && (
            <ChatView tabId={tab.id} initialValue={tab.content} />
          )}
          {tab.kind === 'search' && <SearchView />}
          {tab.kind === 'clipboard' && <ClipboardView />}
          {tab.kind === 'settings' && <SettingsView />}
          {tab.kind === 'shortcuts' && <ShortcutsView />}
          {tab.kind === 'sqlite' && tab.filePath && (
            <SqliteView tabId={tab.id} filePath={tab.filePath} />
          )}
          {tab.kind === 'http' && (
            <HttpClient tabId={tab.id} initialValue={tab.content} />
          )}
          {tab.kind === 'folder' && tab.filePath && (
            <FolderView folderPath={tab.filePath} tabId={tab.id} />
          )}
          {tab.kind === 'web' && tab.filePath && (
            <WebView tabId={tab.id} url={tab.filePath} />
          )}
          {tab.kind === 'terminal' && <Terminal tabId={tab.id} />}
          {tab.kind === 'process' && <ProcessViewer />}
          {tab.kind === 'git' && <GitView />}
          {tab.kind === 'music' && <MusicView tabId={tab.id} initialValue={tab.content} />}
          {tab.kind === 'later' && <LaterView />}
          {tab.kind === 'agent' && (
            <AgentView tabId={tab.id} initialValue={tab.content} />
          )}
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
          </Suspense>
        </div>
        );
      })}
    </div>
  );
}

function MarkdownModeToggle({
  tabId,
  mode,
}: {
  tabId: string;
  mode: 'rendered' | 'raw' | 'split';
}) {
  const set = (next: 'rendered' | 'raw' | 'split') => () =>
    workspace.setMarkdownViewMode(tabId, next);
  return (
    <div className="md-mode-toggle" title="Markdown view (⌘⇧M cycles)">
      <button
        className={`md-mode-btn ${mode === 'rendered' ? 'md-mode-btn--active' : ''}`}
        onClick={set('rendered')}
        title="Rendered"
        aria-label="Rendered"
      >
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden fill="none">
          <path d="M2 4h12M2 8h8M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className={`md-mode-btn ${mode === 'split' ? 'md-mode-btn--active' : ''}`}
        onClick={set('split')}
        title="Split"
        aria-label="Split"
      >
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden fill="none">
          <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
          <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      <button
        className={`md-mode-btn ${mode === 'raw' ? 'md-mode-btn--active' : ''}`}
        onClick={set('raw')}
        title="Raw"
        aria-label="Raw"
      >
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden fill="none">
          <path d="M6 4 L2 8 L6 12 M10 4 L14 8 L10 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
