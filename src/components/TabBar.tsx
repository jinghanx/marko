import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace, workspace, findLeaf, getActiveSession, type Tab } from '../state/workspace';
import { useTabDrag } from '../lib/tabDrag';

interface TabBarProps {
  paneId: string;
  sessionId: string;
  /** Whether this tabbar's pane sits at the leftmost / rightmost edge
   *  of the pane tree. The leftmost tabbar gets the "show sidebar"
   *  reveal button (when sidebar is hidden); the rightmost gets the
   *  "show outline" button (when outline is hidden). */
  edges?: { left: boolean; right: boolean };
}

export function TabBar({ paneId, sessionId, edges = { left: true, right: true } }: TabBarProps) {
  const allTabs = useWorkspace((s) => s.tabs);
  const leaf = useWorkspace((s) => {
    const session = s.sessions.find((x) => x.id === sessionId);
    return session ? findLeaf(session.root, paneId) : null;
  });
  // Sidebar / outline visibility — drives the toggle buttons' tooltips
  // (the icon stays the same; only the title flips between Show/Hide).
  // Buttons are always rendered on the outer-edge tab bars regardless
  // of state so they sit at exactly the same pixel position whether
  // the panel is open or closed — no visual shift on toggle.
  const sidebarVisible = useWorkspace((s) => getActiveSession(s).sidebarVisible);
  const outlineVisible = useWorkspace((s) => getActiveSession(s).outlineVisible);
  const tabs = useMemo(() => {
    if (!leaf) return [];
    const map = new Map(allTabs.map((t) => [t.id, t]));
    return leaf.tabIds.map((id) => map.get(id)).filter((t): t is Tab => !!t);
  }, [leaf, allTabs]);
  const activeTabId = leaf?.activeTabId ?? null;
  const [menu, setMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onMouse = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('.ctx-menu')) return;
      setMenu(null);
    };
    const onKey = () => setMenu(null);
    document.addEventListener('mousedown', onMouse, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onMouse, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  // All hooks must be called unconditionally — the empty-tabs early return
  // below would skip useTabDrag otherwise and React throws "rendered
  // fewer hooks than expected" when the last tab in a leaf is closed.
  const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs]);
  const { state: drag, handlers: dragHandlers } = useTabDrag(
    paneId,
    tabIds,
    (fromLeafId, fromIdx, toLeafId, toIdx) =>
      workspace.moveTab(fromLeafId, fromIdx, toLeafId, toIdx),
  );

  // Render an empty bar with just the `+` button when the leaf has no tabs,
  // so the pane stays visually anchored and the user always has a way to
  // add a new tab (the WelcomeScreen below also has shortcuts).
  if (tabs.length === 0) {
    // Empty tabbars are still valid drop targets so the user can drag a
    // tab from another pane into this empty pane.
    return (
      <div
        className="tabbar tabbar--empty"
        onDragOver={dragHandlers.onStripDragOver}
        onDrop={dragHandlers.onStripDrop}
      >
        {edges.left && <SidebarToggle visible={sidebarVisible} />}
        <button
          className="tab-new"
          onClick={() => workspace.openNewTab()}
          aria-label="New tab"
        >
          +
        </button>
        {edges.right && <OutlineToggle visible={outlineVisible} />}
      </div>
    );
  }

  const closeWithDirtyCheck = (toClose: Tab[]) => {
    const dirty = toClose.filter((t) => t.dirty);
    if (dirty.length > 0) {
      const msg =
        dirty.length === 1
          ? `"${dirty[0].title}" has unsaved changes. Close anyway?`
          : `${dirty.length} tabs have unsaved changes. Close anyway?`;
      if (!window.confirm(msg)) return;
    }
    workspace.closeTabsInLeaf(paneId, toClose.map((t) => t.id));
  };

  return (
    <div
      className="tabbar"
      onDragOver={dragHandlers.onStripDragOver}
      onDrop={dragHandlers.onStripDrop}
    >
      {edges.left && <SidebarToggle visible={sidebarVisible} />}
      {tabs.map((tab, i) => {
        const active = tab.id === activeTabId;
        const isDragging = drag.dragIdx === i;
        const insertSide =
          drag.dragIdx !== null && drag.overIdx === i ? drag.overSide : null;
        return (
          <div
            key={tab.id}
            className={
              `tab tab--${tab.kind} ${active ? 'tab--active' : ''}` +
              (tab.pinned ? ' tab--pinned' : '') +
              (isDragging ? ' tab--dragging' : '') +
              (insertSide === 'before' ? ' tab--drop-before' : '') +
              (insertSide === 'after' ? ' tab--drop-after' : '')
            }
            draggable={renamingId !== tab.id}
            onDragStart={dragHandlers.onDragStart(i)}
            onDragOver={dragHandlers.onDragOver(i)}
            onDrop={dragHandlers.onDrop(i)}
            onDragEnd={dragHandlers.onDragEnd}
            onClick={() => {
              if (renamingId === tab.id) return;
              workspace.setActiveTab(tab.id);
              workspace.requestEditorFocus();
            }}
            onDoubleClick={(e) => {
              // Match the workspace strip's rename UX: double-click the
              // tab to inline-edit its title. Stop propagation so the
              // single-click activate logic above doesn't double-fire.
              e.stopPropagation();
              setRenamingId(tab.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              workspace.setActiveTab(tab.id);
              setMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
            }}
            onAuxClick={(e) => {
              // Middle-click closes the tab (browser convention).
              if (e.button === 1) {
                e.preventDefault();
                closeWithDirtyCheck([tab]);
              }
            }}
            title={tab.filePath ?? tab.title}
          >
            <span className={`tab-icon tab-icon--${tab.kind}`} aria-hidden>
              <KindIcon tab={tab} />
            </span>
            {renamingId === tab.id ? (
              <TabRenameInput
                initial={tab.title}
                onCommit={(name) => {
                  workspace.renameTab(tab.id, name);
                  setRenamingId(null);
                }}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <span className="tab-title">{tab.title}</span>
            )}
            {tab.kind === 'markdown' && tab.viewMode === 'raw' && (
              <span className="tab-mode-badge" title="Raw markdown (⌘⇧M cycles)">RAW</span>
            )}
            {tab.kind === 'markdown' && tab.viewMode === 'split' && (
              <span className="tab-mode-badge" title="Split markdown (⌘⇧M cycles)">SPLIT</span>
            )}
            {tab.dirty && <span className="tab-dirty" aria-label="unsaved" />}
            <button
              className="tab-close"
              draggable={false}
              onClick={(e) => {
                e.stopPropagation();
                closeWithDirtyCheck([tab]);
              }}
              aria-label="Close tab"
            >
              ×
            </button>
          </div>
        );
      })}
      <button className="tab-new" onClick={() => workspace.openNewTab()} aria-label="New tab">
        +
      </button>
      {edges.right && <OutlineToggle visible={outlineVisible} />}

      {menu && (
        <TabContextMenu
          x={menu.x}
          y={menu.y}
          tab={tabs.find((t) => t.id === menu.tabId)!}
          allTabs={tabs}
          onClose={() => setMenu(null)}
          onCloseTab={(t) => closeWithDirtyCheck([t])}
          // "Close Other" and "Close to Right" never close pinned tabs —
          // matches Chrome's pinned-tab behavior.
          onCloseOthers={(t) =>
            closeWithDirtyCheck(tabs.filter((x) => x.id !== t.id && !x.pinned))
          }
          onCloseToRight={(t) => {
            const idx = tabs.findIndex((x) => x.id === t.id);
            closeWithDirtyCheck(tabs.slice(idx + 1).filter((x) => !x.pinned));
          }}
          onCloseAll={() => closeWithDirtyCheck(tabs.filter((x) => !x.pinned))}
          onTogglePin={(t) => workspace.togglePinTab(t.id)}
        />
      )}
    </div>
  );
}

function KindIcon({ tab }: { tab: Tab }) {
  switch (tab.kind) {
    case 'folder':
      return <FolderGlyph />;
    case 'web':
      return <WebFavicon url={tab.filePath} stored={tab.favicon} />;
    case 'markdown':
      return <MarkdownGlyph />;
    case 'image':
      return <ImageGlyph />;
    case 'media':
      return <MediaGlyph />;
    case 'pdf':
      return <PdfGlyph />;
    case 'csv':
      return <TableGlyph />;
    case 'json':
      return <JsonGlyph />;
    case 'diff':
      return <DiffGlyph />;
    case 'binary':
      return <BinaryGlyph />;
    case 'terminal':
      return <TerminalGlyph />;
    case 'process':
      return <ProcessGlyph />;
    case 'git':
      return <GitGlyph />;
    case 'excalidraw':
      return <DrawGlyph />;
    case 'chat':
      return <ChatGlyph />;
    case 'search':
      return <SearchGlyph />;
    case 'http':
      return <HttpGlyph />;
    case 'clipboard':
      return <ClipboardGlyph />;
    case 'settings':
      return <SettingsGlyph />;
    case 'sqlite':
      return <SqliteGlyph />;
    case 'shortcuts':
      return <ShortcutsTabGlyph />;
    case 'code':
    default:
      return <CodeGlyph />;
  }
}

function ShortcutsTabGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <rect x="2" y="4" width="12" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 6.6 L4.5 6.7 M7 6.6 L7 6.7 M9.5 6.6 L9.5 6.7 M12 6.6 L12 6.7 M5 9.4 H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Renders a site favicon for web tabs. Prefers the page-declared
 *  icon URL (captured by WebView from `page-favicon-updated`) since
 *  that picks up real <link rel="icon"> entries with proper sizing.
 *  Falls back to the host's `/favicon.ico` for tabs that haven't
 *  loaded yet, and finally to the globe glyph if both fail or the
 *  filePath isn't an http(s) URL. */
function WebFavicon({ url, stored }: { url: string | null; stored: string | undefined }) {
  const [erroredStored, setErroredStored] = useState(false);
  const [erroredFallback, setErroredFallback] = useState(false);
  let host: string | null = null;
  let origin: string | null = null;
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        host = u.hostname;
        origin = u.origin;
      }
    } catch {
      // ignore — non-URL filePath, fall through to globe
    }
  }
  // Reset error state when the source changes — a different host or a
  // newly-captured stored icon should get a retry.
  useEffect(() => {
    setErroredStored(false);
  }, [stored]);
  useEffect(() => {
    setErroredFallback(false);
  }, [origin]);

  // 1) Page-declared icon: best quality, takes priority while loadable.
  if (stored && !erroredStored) {
    return (
      <img
        className="tab-favicon"
        src={stored}
        alt=""
        width={14}
        height={14}
        loading="lazy"
        decoding="async"
        onError={() => setErroredStored(true)}
      />
    );
  }
  // 2) Bare /favicon.ico probe — works for the brief window before
  //    page-favicon-updated fires, and for sites that don't declare one.
  if (origin && host && !erroredFallback) {
    return (
      <img
        className="tab-favicon"
        src={`${origin}/favicon.ico`}
        alt=""
        width={14}
        height={14}
        loading="lazy"
        decoding="async"
        onError={() => setErroredFallback(true)}
      />
    );
  }
  // 3) Globe glyph fallback.
  return <GlobeGlyph />;
}

function SqliteGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <ellipse cx="8" cy="3.6" rx="5" ry="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 3.6 V8 a5 1.6 0 0 0 10 0 V3.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 8 V12.4 a5 1.6 0 0 0 10 0 V8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function SettingsGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.6 L8 3.4 M8 12.6 L8 14.4 M14.4 8 L12.6 8 M3.4 8 L1.6 8 M12.5 3.5 L11.2 4.8 M4.8 11.2 L3.5 12.5 M12.5 12.5 L11.2 11.2 M4.8 4.8 L3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClipboardGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <rect x="3.5" y="3" width="9" height="11" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6" y="1.6" width="4" height="2.6" rx="0.6" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
      <path d="M5.5 8 H10.5 M5.5 10.5 H9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function TerminalGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.5 6.5 L7 8 L4.5 9.5 M8.5 10 H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TableGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden>
      <FileBase />
      <path d="M4 8 H12 M4 11 H12 M8 5 V13" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

function JsonGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden>
      <FileBase />
      <path
        d="M6.5 6 q-1 0 -1 1 v1 q0 0.6 -0.6 0.6 q0.6 0 0.6 0.6 v1 q0 1 1 1 M9.5 6 q1 0 1 1 v1 q0 0.6 0.6 0.6 q-0.6 0 -0.6 0.6 v1 q0 1 -1 1"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DiffGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <path d="M3 4 H7 M5 2 V6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M9 11 H13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M3 9 L13 9" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 1.5" opacity="0.6" />
    </svg>
  );
}

function PdfGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden>
      <FileBase />
      <text
        x="8"
        y="11.6"
        textAnchor="middle"
        fontSize="4"
        fontWeight="700"
        fontFamily="-apple-system, sans-serif"
        fill="currentColor"
      >
        PDF
      </text>
    </svg>
  );
}

function MediaGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden>
      <FileBase />
      <path d="M6 8 L11 5 L11 11 Z" fill="currentColor" />
    </svg>
  );
}

function ProcessGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <path d="M2 12 L5 8 L8 10 L11 5 L14 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HttpGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <path d="M2 5 L8 5 L8 11 L14 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 8 L14 11 L11 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 10 L13.5 13.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ChatGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <path
        d="M2 4 a1 1 0 0 1 1 -1 h10 a1 1 0 0 1 1 1 v6 a1 1 0 0 1 -1 1 h-7 l-3 2.5 v-2.5 h-0 a1 1 0 0 1 -1 -1 z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="7" r="0.9" fill="currentColor" />
      <circle cx="8.5" cy="7" r="0.9" fill="currentColor" />
      <circle cx="11" cy="7" r="0.9" fill="currentColor" />
    </svg>
  );
}

function DrawGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <path
        d="M3 13 L3 11 L10.5 3.5 L12.5 5.5 L5 13 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M9.5 4.5 L11.5 6.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function GitGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <circle cx="4" cy="3" r="1.4" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="4" cy="13" r="1.4" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="3" r="1.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4 4.4 V11.6 M4 6 q0 4 8 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden>
      <path
        d="M2 4 a1 1 0 0 1 1 -1 h3.5 l1.5 1.5 h5 a1 1 0 0 1 1 1 v6 a1 1 0 0 1 -1 1 h-10 a1 1 0 0 1 -1 -1 z"
        fill="currentColor"
      />
    </svg>
  );
}

function GlobeGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 8 h12 M8 2 c-3 4 -3 8 0 12 M8 2 c3 4 3 8 0 12" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function FileBase() {
  return (
    <path
      d="M3 2 h7 l3 3 v9 a0.5 0.5 0 0 1 -0.5 0.5 h-9.5 a0.5 0.5 0 0 1 -0.5 -0.5 v-11.5 a0.5 0.5 0 0 1 0.5 -0.5 z M10 2 v3 h3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  );
}

function MarkdownGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden>
      <FileBase />
      <text
        x="8"
        y="11.6"
        textAnchor="middle"
        fontSize="4.5"
        fontWeight="700"
        fontFamily="-apple-system, sans-serif"
        fill="currentColor"
      >
        MD
      </text>
    </svg>
  );
}

function CodeGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden>
      <FileBase />
      <path
        d="M6.4 8.5 L4.8 10.1 L6.4 11.7 M9.6 8.5 L11.2 10.1 L9.6 11.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ImageGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden>
      <FileBase />
      <circle cx="6" cy="9.5" r="0.9" fill="currentColor" />
      <path
        d="M3.6 13 L6.5 10.5 L8.5 12 L11 9.6 L13 11.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BinaryGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden>
      <FileBase />
      <text
        x="8"
        y="12.2"
        textAnchor="middle"
        fontSize="4.2"
        fontFamily="ui-monospace, Menlo, monospace"
        fill="currentColor"
      >
        01
      </text>
    </svg>
  );
}

function TabContextMenu({
  x,
  y,
  tab,
  allTabs,
  onClose,
  onCloseTab,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onTogglePin,
}: {
  x: number;
  y: number;
  tab: Tab;
  allTabs: Tab[];
  onClose: () => void;
  onCloseTab: (t: Tab) => void;
  onCloseOthers: (t: Tab) => void;
  onCloseToRight: (t: Tab) => void;
  onCloseAll: () => void;
  onTogglePin: (t: Tab) => void;
}) {
  const wrap = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const idx = allTabs.findIndex((t) => t.id === tab.id);
  const hasRight = idx >= 0 && idx < allTabs.length - 1;
  const hasOthers = allTabs.length > 1;
  const isFolder = tab.kind === 'folder';

  return (
    <div
      className="ctx-menu"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button className="ctx-menu-item" onClick={wrap(() => onTogglePin(tab))}>
        {tab.pinned ? 'Unpin Tab' : 'Pin Tab'}
      </button>
      <div className="ctx-menu-sep" />
      <button className="ctx-menu-item" onClick={wrap(() => onCloseTab(tab))}>
        Close <span className="ctx-menu-kbd">⌘W</span>
      </button>
      <button
        className="ctx-menu-item"
        onClick={wrap(() => onCloseOthers(tab))}
        disabled={!hasOthers}
        style={!hasOthers ? { opacity: 0.4, cursor: 'default' } : undefined}
      >
        Close Other Tabs
      </button>
      <button
        className="ctx-menu-item"
        onClick={wrap(() => onCloseToRight(tab))}
        disabled={!hasRight}
        style={!hasRight ? { opacity: 0.4, cursor: 'default' } : undefined}
      >
        Close Tabs to the Right
      </button>
      <button className="ctx-menu-item" onClick={wrap(onCloseAll)}>
        Close All Tabs
      </button>

      {tab.filePath && (
        <>
          <div className="ctx-menu-sep" />
          <button
            className="ctx-menu-item"
            onClick={wrap(() => void navigator.clipboard.writeText(tab.filePath!))}
          >
            Copy Path
          </button>
          <button
            className="ctx-menu-item"
            onClick={wrap(() => void window.marko.revealInFinder(tab.filePath!))}
          >
            Reveal in Finder
          </button>
          {isFolder && (
            <button
              className="ctx-menu-item"
              onClick={wrap(() => workspace.setRootDir(tab.filePath!))}
            >
              Open as Workspace
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Sidebar toggle — sits at the leftmost edge of the leftmost pane's
 *  tab bar. Always rendered (regardless of whether the sidebar is
 *  open or closed) so the button stays at exactly the same pixel
 *  position across toggles. Only the icon's "filled" tint changes so
 *  the user can tell at a glance whether the panel is currently open. */
function SidebarToggle({ visible }: { visible: boolean }) {
  return (
    <button
      className="tabbar-edge-btn"
      onClick={() => workspace.toggleSidebar()}
      title={`${visible ? 'Hide' : 'Show'} sidebar · ⌘E`}
      aria-label={visible ? 'Hide sidebar' : 'Show sidebar'}
    >
      <PanelIcon side="left" filled={visible} />
    </button>
  );
}

/** Outline toggle — rightmost edge of the rightmost pane's tab bar.
 *  Same always-rendered pattern as the sidebar toggle. The
 *  margin-left:auto push ensures it anchors to the right edge of the
 *  bar past the tabs and the `+` button. */
function OutlineToggle({ visible }: { visible: boolean }) {
  return (
    <button
      className="tabbar-edge-btn tabbar-edge-btn--push-right"
      onClick={() => workspace.toggleOutline()}
      title={`${visible ? 'Hide' : 'Show'} outline · ⌘⇧\\`}
      aria-label={visible ? 'Hide outline' : 'Show outline'}
    >
      <PanelIcon side="right" filled={visible} />
    </button>
  );
}

/** Same pictogram as IconSidebarPanel in Sidebar.tsx: a rounded
 *  rectangle with a thin column on the indicated side. `filled`
 *  fills that column so users can read the toggle's current state at
 *  a glance — filled = panel currently visible. */
function PanelIcon({ side, filled }: { side: 'left' | 'right'; filled?: boolean }) {
  const barX = side === 'left' ? 2.6 : 10;
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden fill="none">
      <rect x="2" y="3.5" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <rect
        x={barX}
        y="4.1"
        width="3.4"
        height="7.8"
        rx="1.4"
        fill={filled ? 'currentColor' : 'none'}
        opacity={filled ? 0.35 : 1}
        stroke={filled ? undefined : 'currentColor'}
        strokeWidth={filled ? undefined : 1}
      />
    </svg>
  );
}

/** Inline rename field for a file tab. Mirrors SessionStrip's
 *  RenameInput — autoselects the existing title on mount, commits on
 *  Enter or blur, cancels on Escape. */
function TabRenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
  }, []);
  return (
    <input
      ref={ref}
      defaultValue={initial}
      className="tab-rename"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit((e.target as HTMLInputElement).value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={(e) => onCommit(e.target.value)}
    />
  );
}
