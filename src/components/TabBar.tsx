import { useEffect, useMemo, useState } from 'react';
import { useWorkspace, workspace, findLeaf, type Tab } from '../state/workspace';

interface TabBarProps {
  paneId: string;
}

export function TabBar({ paneId }: TabBarProps) {
  const allTabs = useWorkspace((s) => s.tabs);
  const leaf = useWorkspace((s) => findLeaf(s.root, paneId));
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

  if (tabs.length === 0) return null;

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
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`tab tab--${tab.kind} ${active ? 'tab--active' : ''}`}
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
          onCloseOthers={(t) => closeWithDirtyCheck(tabs.filter((x) => x.id !== t.id))}
          onCloseToRight={(t) => {
            const idx = tabs.findIndex((x) => x.id === t.id);
            closeWithDirtyCheck(tabs.slice(idx + 1));
          }}
          onCloseAll={() => closeWithDirtyCheck(tabs)}
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
    case 'binary':
      return <BinaryGlyph />;
    case 'terminal':
      return <TerminalGlyph />;
    case 'code':
    default:
      return <CodeGlyph />;
  }
}

function TerminalGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden fill="none">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.5 6.5 L7 8 L4.5 9.5 M8.5 10 H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
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
