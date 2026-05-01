import { useEffect, useMemo, useState } from 'react';
import { useWorkspace, workspace, findLeaf, type Tab } from '../state/workspace';
import { useDragReorder } from '../lib/dragReorder';

interface TabBarProps {
  paneId: string;
  sessionId: string;
}

export function TabBar({ paneId, sessionId }: TabBarProps) {
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
  const [menu, setMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

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
  // below would skip useDragReorder otherwise and React throws "rendered
  // fewer hooks than expected" when the last tab in a leaf is closed.
  const { state: drag, handlers: dragHandlers } = useDragReorder((from, to) =>
    workspace.reorderTabInLeaf(paneId, from, to),
  );

  // Render an empty bar with just the `+` button when the leaf has no tabs,
  // so the pane stays visually anchored and the user always has a way to
  // add a new tab (the WelcomeScreen below also has shortcuts).
  if (tabs.length === 0) {
    return (
      <div className="tabbar tabbar--empty">
        <button
          className="tab-new"
          onClick={() => workspace.openNewTab()}
          aria-label="New tab"
        >
          +
        </button>
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
    <div className="tabbar">
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
            draggable
            onDragStart={dragHandlers.onDragStart(i)}
            onDragOver={dragHandlers.onDragOver(i)}
            onDrop={dragHandlers.onDrop(i)}
            onDragEnd={dragHandlers.onDragEnd}
            onClick={() => {
              workspace.setActiveTab(tab.id);
              workspace.requestEditorFocus();
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
              <KindIcon kind={tab.kind} />
            </span>
            <span className="tab-title">{tab.title}</span>
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

function KindIcon({ kind }: { kind: Tab['kind'] }) {
  switch (kind) {
    case 'folder':
      return <FolderGlyph />;
    case 'web':
      return <GlobeGlyph />;
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
    case 'code':
    default:
      return <CodeGlyph />;
  }
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
