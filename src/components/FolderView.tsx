import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { openFileFromPath } from '../lib/actions';
import { detectKind } from '../lib/fileType';
import { workspace } from '../state/workspace';
import { fileClipboard } from '../lib/fileClipboard';
import type { DirEntry } from '../types/marko';
import {
  settings,
  useSettings,
  type FolderSort,
  type FolderSortKey,
  type SortDirection,
} from '../state/settings';

interface Props {
  folderPath: string;
  tabId: string;
}

interface History {
  stack: string[];
  cursor: number;
}

interface ItemProps {
  entry: DirEntry;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  selected: boolean;
  cut: boolean;
  /** True while this folder item is the active drop target. */
  dropTarget: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

/** Custom MIME used for in-app drags. We piggyback `text/plain` for compat
 *  with native drop targets (Finder, terminals) but only consume our own. */
const MARKO_FILES_MIME = 'application/x-marko-files';

const PREVIEWABLE_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);

export function FolderView({ folderPath: initialPath, tabId }: Props) {
  const [history, setHistory] = useState<History>(() => ({ stack: [initialPath], cursor: 0 }));
  const currentPath = history.stack[history.cursor];

  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // If the prop path is updated (e.g., the tab is reused for a different folder),
  // reset history to the new path.
  useEffect(() => {
    setHistory((h) => {
      if (h.stack[h.cursor] === initialPath) return h;
      return { stack: [initialPath], cursor: 0 };
    });
  }, [initialPath]);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    window.marko
      .listDir(currentPath)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  const navigate = (path: string) => {
    setHistory((h) => {
      // Truncate any forward history, then push.
      if (h.stack[h.cursor] === path) return h;
      const stack = h.stack.slice(0, h.cursor + 1);
      stack.push(path);
      return { stack, cursor: stack.length - 1 };
    });
  };

  const goBack = () => {
    setHistory((h) => (h.cursor > 0 ? { ...h, cursor: h.cursor - 1 } : h));
  };

  const goForward = () => {
    setHistory((h) =>
      h.cursor < h.stack.length - 1 ? { ...h, cursor: h.cursor + 1 } : h,
    );
  };

  const goUp = () => {
    const slash = currentPath.lastIndexOf('/');
    if (slash > 0) navigate(currentPath.slice(0, slash));
  };

  const canBack = history.cursor > 0;
  const canForward = history.cursor < history.stack.length - 1;

  const segments = currentPath.split('/').filter(Boolean);

  const settingsState = useSettings();
  const sort = settingsState.folderSort;
  const showHidden = settingsState.showHiddenFiles;
  const iconSize = settingsState.folderIconSize;
  const filteredEntries = useMemo(
    () => (entries ? (showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'))) : null),
    [entries, showHidden],
  );
  const sortedEntries = useMemo(
    () => (filteredEntries ? sortEntries(filteredEntries, sort) : null),
    [filteredEntries, sort],
  );
  const sections = useMemo(
    () => (sortedEntries ? groupEntries(sortedEntries, sort) : null),
    [sortedEntries, sort],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [dragRect, setDragRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: DirEntry } | null>(null);
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);
  /** Path of the directory item currently highlighted as a drop target. */
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  /** Tracks the drag operation's payload for drop handlers — kept in a ref so
   *  drop targets can read it even when dataTransfer is empty (which Chromium
   *  enforces during dragover for security). */
  const dragPayloadRef = useRef<string[]>([]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // True if a drag-select actually moved (so the trailing click should be ignored).
  const dragHappenedRef = useRef(false);

  // Subscribe to clipboard so cut items can be visually faded.
  const clipboard = useSyncExternalStore(
    fileClipboard.subscribe,
    fileClipboard.get,
    fileClipboard.get,
  );
  const cutSet = useMemo(
    () => (clipboard?.mode === 'cut' ? new Set(clipboard.paths) : new Set<string>()),
    [clipboard],
  );

  // Close context menu on outside click / any keydown.
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

  // Same behavior for the empty-space (background) menu.
  useEffect(() => {
    if (!bgMenu) return;
    const onMouse = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('.ctx-menu')) return;
      setBgMenu(null);
    };
    const onKey = () => setBgMenu(null);
    document.addEventListener('mousedown', onMouse, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onMouse, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [bgMenu]);

  const refreshCurrent = async () => {
    try {
      const list = await window.marko.listDir(currentPath);
      setEntries(list);
    } catch {
      // ignore
    }
  };

  const onItemContextMenu = (e: React.MouseEvent, entry: DirEntry) => {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicking outside the current selection, replace it.
    setSelected((prev) => (prev.has(entry.path) ? prev : new Set([entry.path])));
    setLastClicked(entry.path);
    setMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const doRename = (entry: DirEntry) => {
    const lastSlash = entry.path.lastIndexOf('/');
    const dir = entry.path.slice(0, lastSlash);
    const newName = window.prompt('New name:', entry.name);
    if (!newName || newName === entry.name) return;
    const newPath = `${dir}/${newName}`;
    void window.marko.rename(entry.path, newPath).then((r) => {
      if (r.ok) void refreshCurrent();
      else window.alert(r.error ?? 'rename failed');
    });
  };

  const doTrash = (entry: DirEntry) => {
    if (!window.confirm(`Move "${entry.name}" to Trash?`)) return;
    void window.marko.trash(entry.path).then((r) => {
      if (r.ok) void refreshCurrent();
      else window.alert(r.error ?? 'trash failed');
    });
  };

  /** "Compare With…" — picks a second file via the open dialog and opens
   *  a diff tab against the chosen entry. */
  const doCompare = async (entry: DirEntry) => {
    const result = await window.marko.openFileDialog();
    if (!result) return;
    if (result.filePath === entry.path) return;
    workspace.openDiffTab(entry.path, result.filePath);
  };

  const doNewFolder = async () => {
    const name = window.prompt('New folder name:', 'New Folder');
    if (!name) return;
    const dest = await uniqueDest(currentPath, name);
    const r = await window.marko.createDir(dest);
    if (!r.ok) {
      window.alert(r.error ?? 'create folder failed');
      return;
    }
    await refreshCurrent();
    setSelected(new Set([dest]));
    setLastClicked(dest);
  };

  /** Move the given source paths into `destDir`, holding Option for copy. */
  const doDropMove = async (sources: string[], destDir: string, copy: boolean) => {
    for (const src of sources) {
      const name = src.split('/').pop() ?? src;
      const dest = await uniqueDest(destDir, name);
      if (src === dest) continue;
      // Don't drop a folder into itself or a descendant.
      if (destDir === src || destDir.startsWith(src + '/')) continue;
      const r = copy
        ? await window.marko.copy(src, dest)
        : await window.marko.rename(src, dest);
      if (!r.ok) {
        window.alert(`${copy ? 'copy' : 'move'} failed: ${r.error}`);
        break;
      }
    }
    await refreshCurrent();
  };

  const onItemDragStart = (e: React.DragEvent, entry: DirEntry) => {
    // If dragging an item that isn't part of the current selection, drag just
    // that one (and replace selection so the visual matches).
    let paths: string[];
    if (selected.has(entry.path) && selected.size > 1) {
      paths = [...selected];
    } else {
      paths = [entry.path];
      setSelected(new Set([entry.path]));
      setLastClicked(entry.path);
    }
    dragPayloadRef.current = paths;
    try {
      e.dataTransfer.setData(MARKO_FILES_MIME, JSON.stringify(paths));
      // Plain text fallback so native targets still see something useful.
      e.dataTransfer.setData('text/plain', paths.join('\n'));
    } catch {
      // ignore
    }
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const onItemDragEnter = (e: React.DragEvent, entry: DirEntry) => {
    if (!entry.isDirectory) return;
    if (dragPayloadRef.current.length === 0) return;
    // Disallow dropping onto a source path or into a descendant of a source.
    if (
      dragPayloadRef.current.some(
        (src) => entry.path === src || entry.path.startsWith(src + '/'),
      )
    ) {
      return;
    }
    e.preventDefault();
    setDropTargetPath(entry.path);
  };

  const onItemDragOver = (e: React.DragEvent, entry: DirEntry) => {
    if (!entry.isDirectory) return;
    if (dragPayloadRef.current.length === 0) return;
    if (
      dragPayloadRef.current.some(
        (src) => entry.path === src || entry.path.startsWith(src + '/'),
      )
    ) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
  };

  const onItemDragLeave = (_e: React.DragEvent, entry: DirEntry) => {
    setDropTargetPath((cur) => (cur === entry.path ? null : cur));
  };

  const onItemDrop = (e: React.DragEvent, entry: DirEntry) => {
    if (!entry.isDirectory) return;
    e.preventDefault();
    e.stopPropagation();
    const sources = dragPayloadRef.current;
    dragPayloadRef.current = [];
    setDropTargetPath(null);
    if (sources.length === 0) return;
    void doDropMove(sources, entry.path, e.altKey);
  };

  const doNewFile = async () => {
    const name = window.prompt('New file name:', 'untitled.md');
    if (!name) return;
    const dest = await uniqueDest(currentPath, name);
    const r = await window.marko.createFile(dest);
    if (!r.ok) {
      window.alert(r.error ?? 'create file failed');
      return;
    }
    await refreshCurrent();
    setSelected(new Set([dest]));
    setLastClicked(dest);
    void openFileFromPath(dest, { focus: true });
  };

  // Reset selection on path change.
  useEffect(() => {
    setSelected(new Set());
    setLastClicked(null);
  }, [currentPath]);

  // Keep the cursor item visible when navigating with the keyboard.
  useEffect(() => {
    if (!lastClicked) return;
    const el = gridRef.current?.querySelector<HTMLElement>(
      `.folder-item[data-path="${CSS.escape(lastClicked)}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [lastClicked]);

  const flatItems = useMemo(() => sections?.flatMap((s) => s.entries) ?? [], [sections]);

  // Publish selection summary to workspace so the Outline (Preview) pane reflects it.
  useEffect(() => {
    const all = entries ?? [];
    const folderCount = all.filter((e) => e.isDirectory).length;
    const fileCount = all.length - folderCount;
    const selectedEntries = all.filter((e) => selected.has(e.path));
    workspace.setFolderSelection({
      tabId,
      currentPath,
      selected: selectedEntries,
      totalCount: all.length,
      folderCount,
      fileCount,
    });
  }, [entries, selected, currentPath, tabId]);

  // Clear when this view unmounts (so Outline doesn't show stale data).
  useEffect(() => {
    return () => {
      const cur = workspace.getState().folderSelection;
      if (cur && cur.tabId === tabId) workspace.setFolderSelection(null);
    };
  }, [tabId]);

  const openItem = (entry: DirEntry) => {
    if (entry.isDirectory) navigate(entry.path);
    else void openFileFromPath(entry.path, { focus: false });
  };

  const onClickItem = (entry: DirEntry, e: React.MouseEvent) => {
    const meta = e.metaKey || e.ctrlKey;
    const shift = e.shiftKey;
    if (shift && lastClicked) {
      // Range select between lastClicked and entry.
      const a = flatItems.findIndex((i) => i.path === lastClicked);
      const b = flatItems.findIndex((i) => i.path === entry.path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(flatItems.slice(lo, hi + 1).map((i) => i.path)));
      }
    } else if (meta) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      setLastClicked(entry.path);
    } else {
      setSelected(new Set([entry.path]));
      setLastClicked(entry.path);
    }
    gridRef.current?.focus();
  };

  const onDoubleClickItem = (entry: DirEntry) => {
    openItem(entry);
  };

  const moveCursorByIndex = (delta: number) => {
    const idx = lastClicked ? flatItems.findIndex((i) => i.path === lastClicked) : -1;
    const start = idx < 0 ? 0 : idx;
    const next = Math.max(0, Math.min(flatItems.length - 1, start + delta));
    const path = flatItems[next].path;
    setSelected(new Set([path]));
    setLastClicked(path);
  };

  // Visual move: find the item directly above/below the current one by
  // measuring bounding boxes — robust against section headers and ragged rows.
  const moveCursorVertical = (direction: 'up' | 'down') => {
    const grid = gridRef.current;
    if (!grid) return;
    const all = Array.from(grid.querySelectorAll<HTMLElement>('.folder-item'));
    if (all.length === 0) return;
    const cur = lastClicked
      ? all.find((el) => el.getAttribute('data-path') === lastClicked)
      : all[0];
    if (!cur) {
      const path = all[0].getAttribute('data-path');
      if (path) {
        setSelected(new Set([path]));
        setLastClicked(path);
      }
      return;
    }
    const cr = cur.getBoundingClientRect();
    const cx = cr.left + cr.width / 2;
    let best: { el: HTMLElement; score: number } | null = null;
    for (const el of all) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      if (direction === 'down' && r.top <= cr.top + 1) continue;
      if (direction === 'up' && r.top >= cr.top - 1) continue;
      const verticalDist =
        direction === 'down' ? r.top - cr.bottom : cr.top - r.bottom;
      const ex = r.left + r.width / 2;
      const horizontalDist = Math.abs(ex - cx);
      // Strongly prefer the nearest row, then the closest horizontal alignment.
      const score = Math.max(0, verticalDist) * 1000 + horizontalDist;
      if (!best || score < best.score) best = { el, score };
    }
    if (!best) return;
    const path = best.el.getAttribute('data-path');
    if (!path) return;
    setSelected(new Set([path]));
    setLastClicked(path);
  };

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (flatItems.length === 0) return;
    const cur = lastClicked ? flatItems.find((i) => i.path === lastClicked) ?? null : null;
    if (e.key === ' ') {
      e.preventDefault();
      if (cur) void window.marko.quickLook(cur.path);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cur) openItem(cur);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveCursorByIndex(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveCursorByIndex(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveCursorVertical('down');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveCursorVertical('up');
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      setSelected(new Set(flatItems.map((i) => i.path)));
    } else if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'x')) {
      e.preventDefault();
      if (selected.size === 0) return;
      fileClipboard.set(e.key === 'c' ? 'copy' : 'cut', [...selected]);
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      e.preventDefault();
      void doPaste();
    } else if ((e.metaKey || e.ctrlKey) && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      void doTrashSelected();
    }
  };

  const doTrashSelected = async () => {
    if (selected.size === 0) return;
    const paths = [...selected];
    for (const p of paths) {
      const r = await window.marko.trash(p);
      if (!r.ok) {
        window.alert(`trash failed: ${r.error}`);
        break;
      }
    }
    setSelected(new Set());
    setLastClicked(null);
    await refreshCurrent();
  };

  const doPaste = async () => {
    const cb = fileClipboard.get();
    if (!cb || cb.paths.length === 0) return;
    for (const src of cb.paths) {
      const name = src.split('/').pop() ?? src;
      const dest = await uniqueDest(currentPath, name);
      // Don't paste a folder onto itself or into itself.
      if (src === dest || dest.startsWith(src + '/')) continue;
      let result: { ok: boolean; error?: string };
      if (cb.mode === 'cut') {
        result = await window.marko.rename(src, dest);
      } else {
        result = await window.marko.copy(src, dest);
      }
      if (!result.ok) {
        window.alert(`${cb.mode} failed: ${result.error}`);
        break;
      }
    }
    if (cb.mode === 'cut') fileClipboard.clear();
    await refreshCurrent();
  };

  // Keyboard shortcuts: ⌘[/⌘] back/forward, ⌘↑ up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === '[') {
        if (canBack) {
          e.preventDefault();
          goBack();
        }
      } else if (e.key === ']') {
        if (canForward) {
          e.preventDefault();
          goForward();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        goUp();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canBack, canForward, currentPath]);

  // Mouse X1/X2 (back/forward — common on MX-style mice). Scope to clicks
  // inside this folder view so multiple folder tabs don't all navigate at
  // once. mousedown + preventDefault to also suppress Chromium's default
  // history navigation that would otherwise fire from the same event.
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      const grid = gridRef.current;
      if (!grid) return;
      const root = grid.closest('.folder-view') as HTMLElement | null;
      if (!root) return;
      const target = e.target as Node;
      if (!root.contains(target)) return;
      e.preventDefault();
      if (e.button === 3 && canBack) goBack();
      else if (e.button === 4 && canForward) goForward();
    };
    window.addEventListener('mousedown', onMouse);
    return () => window.removeEventListener('mousedown', onMouse);
  }, [canBack, canForward, currentPath]);

  return (
    <div className="folder-view">
      <div className="folder-toolbar">
        <div className="folder-nav">
          <button
            className="folder-nav-btn"
            disabled={!canBack}
            onClick={goBack}
            title="Back (⌘[)"
            aria-label="Back"
          >
            <Chevron dir="left" />
          </button>
          <button
            className="folder-nav-btn"
            disabled={!canForward}
            onClick={goForward}
            title="Forward (⌘])"
            aria-label="Forward"
          >
            <Chevron dir="right" />
          </button>
        </div>
        <Breadcrumb segments={segments} folderPath={currentPath} onNavigate={navigate} />
        <SortMenu sort={sort} onChange={(s) => settings.update({ folderSort: s })} />
        <input
          className="folder-icon-slider"
          type="range"
          min={32}
          max={160}
          step={4}
          value={iconSize}
          onChange={(e) => settings.update({ folderIconSize: parseInt(e.target.value, 10) })}
          title={`Icon size: ${iconSize}px`}
          aria-label="Icon size"
        />
        <span className="folder-count">
          {entries ? `${entries.length} item${entries.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      <div
        className="folder-grid"
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        onDragEnd={() => {
          dragPayloadRef.current = [];
          setDropTargetPath(null);
        }}
        onContextMenu={(e) => {
          const target = e.target as Element;
          // Item right-clicks are handled inline by FolderItem — only fire
          // the background menu when the target is truly empty space.
          if (target.closest('.folder-item')) return;
          e.preventDefault();
          setSelected(new Set());
          setLastClicked(null);
          setBgMenu({ x: e.clientX, y: e.clientY });
        }}
        onClick={(e) => {
          const target = e.target as Element;
          if (target.closest('.folder-item')) return;
          // Suppress the click that follows a real drag-select gesture.
          if (dragHappenedRef.current) {
            dragHappenedRef.current = false;
            return;
          }
          setSelected(new Set());
          setLastClicked(null);
        }}
        onMouseDown={(e) => {
          const target = e.target as Element;
          if (target.closest('.folder-item')) return;
          if (e.button !== 0) return;
          const grid = gridRef.current;
          if (!grid) return;
          const rect = grid.getBoundingClientRect();
          const x = e.clientX;
          const y = e.clientY;
          dragHappenedRef.current = false;
          const baseSelection = e.metaKey || e.ctrlKey ? new Set(selected) : new Set<string>();
          const onMove = (ev: MouseEvent) => {
            const dx = Math.abs(ev.clientX - x);
            const dy = Math.abs(ev.clientY - y);
            // Only treat as a drag once the cursor has moved past a small threshold.
            if (!dragHappenedRef.current && dx < 3 && dy < 3) return;
            dragHappenedRef.current = true;
            const cx = Math.max(rect.left, Math.min(rect.right, ev.clientX));
            const cy = Math.max(rect.top, Math.min(rect.bottom, ev.clientY));
            const r = { x0: x, y0: y, x1: cx, y1: cy };
            setDragRect(r);
            const sel = new Set(baseSelection);
            const lo = Math.min(r.x0, r.x1);
            const hi = Math.max(r.x0, r.x1);
            const top = Math.min(r.y0, r.y1);
            const bot = Math.max(r.y0, r.y1);
            grid.querySelectorAll<HTMLElement>('.folder-item').forEach((el) => {
              const ir = el.getBoundingClientRect();
              if (ir.right < lo || ir.left > hi || ir.bottom < top || ir.top > bot) return;
              const path = el.getAttribute('data-path');
              if (path) sel.add(path);
            });
            setSelected(sel);
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            setDragRect(null);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }}
      >
        {error && <div className="folder-error">{error}</div>}
        {!error && !entries && <div className="folder-empty">Loading…</div>}
        {entries && entries.length === 0 && <div className="folder-empty">Empty folder</div>}
        {sections?.map((section, i) => (
          <FolderSection
            key={section.label || `_${i}`}
            label={section.label}
            entries={section.entries}
            onClickItem={onClickItem}
            onDoubleClickItem={onDoubleClickItem}
            onContextMenuItem={onItemContextMenu}
            selected={selected}
            cutSet={cutSet}
            dropTargetPath={dropTargetPath}
            onItemDragStart={onItemDragStart}
            onItemDragEnter={onItemDragEnter}
            onItemDragOver={onItemDragOver}
            onItemDragLeave={onItemDragLeave}
            onItemDrop={onItemDrop}
          />
        ))}
        {dragRect && (
          <div
            className="folder-drag-rect"
            style={{
              position: 'fixed',
              left: Math.min(dragRect.x0, dragRect.x1),
              top: Math.min(dragRect.y0, dragRect.y1),
              width: Math.abs(dragRect.x1 - dragRect.x0),
              height: Math.abs(dragRect.y1 - dragRect.y0),
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
      {menu && (
        <FolderContextMenu
          x={menu.x}
          y={menu.y}
          entry={menu.entry}
          onClose={() => setMenu(null)}
          onOpen={() => openItem(menu.entry)}
          onOpenDefault={() => void window.marko.openDefault(menu.entry.path)}
          onQuickLook={() => void window.marko.quickLook(menu.entry.path)}
          onOpenAsWorkspace={() => workspace.setRootDir(menu.entry.path)}
          onBookmark={() => {
            const cur = settings.get();
            if (cur.workspaceBookmarks.some((b) => b.path === menu.entry.path)) return;
            settings.update({
              workspaceBookmarks: [
                ...cur.workspaceBookmarks,
                { name: menu.entry.name, path: menu.entry.path },
              ],
            });
          }}
          onCopyPath={() => void navigator.clipboard.writeText(menu.entry.path)}
          onCopyName={() => void navigator.clipboard.writeText(menu.entry.name)}
          onReveal={() => void window.marko.revealInFinder(menu.entry.path)}
          onRename={() => doRename(menu.entry)}
          onCompare={() => void doCompare(menu.entry)}
          onTrash={() => doTrash(menu.entry)}
        />
      )}
      {bgMenu && (
        <FolderBgContextMenu
          x={bgMenu.x}
          y={bgMenu.y}
          canPaste={!!clipboard && clipboard.paths.length > 0}
          onClose={() => setBgMenu(null)}
          onNewFile={() => void doNewFile()}
          onNewFolder={() => void doNewFolder()}
          onPaste={() => void doPaste()}
          onReveal={() => void window.marko.revealInFinder(currentPath)}
          onRefresh={() => void refreshCurrent()}
          onOpenAsWorkspace={() => workspace.setRootDir(currentPath)}
        />
      )}
    </div>
  );
}

// Find a non-conflicting destination path under `parent` for an item named `name`.
async function uniqueDest(parent: string, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = `${parent}/${name}`;
  if (!(await window.marko.exists(candidate))) return candidate;
  for (let i = 2; i < 1000; i++) {
    candidate = `${parent}/${stem} (${i})${ext}`;
    if (!(await window.marko.exists(candidate))) return candidate;
  }
  return `${parent}/${stem} (copy)${ext}`;
}

// Roughly compute grid column count from the live layout.
function computeGridCols(grid: HTMLDivElement | null): number {
  if (!grid) return 1;
  const items = grid.querySelectorAll<HTMLElement>('.folder-item');
  if (items.length < 2) return 1;
  const firstTop = items[0].offsetTop;
  let cols = 0;
  for (const el of items) {
    if (el.offsetTop !== firstTop) break;
    cols++;
  }
  return Math.max(1, cols);
}

function FolderSection({
  label,
  entries,
  onClickItem,
  onDoubleClickItem,
  onContextMenuItem,
  selected,
  cutSet,
  dropTargetPath,
  onItemDragStart,
  onItemDragEnter,
  onItemDragOver,
  onItemDragLeave,
  onItemDrop,
}: {
  label: string;
  entries: DirEntry[];
  onClickItem: (entry: DirEntry, e: React.MouseEvent) => void;
  onDoubleClickItem: (e: DirEntry) => void;
  onContextMenuItem: (e: React.MouseEvent, entry: DirEntry) => void;
  selected: Set<string>;
  cutSet: Set<string>;
  dropTargetPath: string | null;
  onItemDragStart: (e: React.DragEvent, entry: DirEntry) => void;
  onItemDragEnter: (e: React.DragEvent, entry: DirEntry) => void;
  onItemDragOver: (e: React.DragEvent, entry: DirEntry) => void;
  onItemDragLeave: (e: React.DragEvent, entry: DirEntry) => void;
  onItemDrop: (e: React.DragEvent, entry: DirEntry) => void;
}) {
  return (
    <>
      {label && <div className="folder-section">{label}</div>}
      {entries.map((e) => (
        <FolderItem
          key={e.path}
          entry={e}
          selected={selected.has(e.path)}
          cut={cutSet.has(e.path)}
          dropTarget={dropTargetPath === e.path}
          onClick={(ev) => onClickItem(e, ev)}
          onDoubleClick={() => onDoubleClickItem(e)}
          onContextMenu={(ev) => onContextMenuItem(ev, e)}
          onDragStart={(ev) => onItemDragStart(ev, e)}
          onDragEnter={(ev) => onItemDragEnter(ev, e)}
          onDragOver={(ev) => onItemDragOver(ev, e)}
          onDragLeave={(ev) => onItemDragLeave(ev, e)}
          onDrop={(ev) => onItemDrop(ev, e)}
        />
      ))}
    </>
  );
}

// ---------- Sorting ----------

function sortEntries(entries: DirEntry[], sort: FolderSort): DirEntry[] {
  const dir = sort.direction === 'asc' ? 1 : -1;
  const cmp = (a: DirEntry, b: DirEntry): number => {
    if (sort.foldersFirst && a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    let r = 0;
    switch (sort.key) {
      case 'name':
        r = a.name.localeCompare(b.name);
        break;
      case 'modified':
        r = a.mtimeMs - b.mtimeMs;
        break;
      case 'created':
        r = a.ctimeMs - b.ctimeMs;
        break;
      case 'size':
        r = a.size - b.size;
        break;
      case 'type': {
        const aExt = a.isDirectory ? '' : (a.name.split('.').pop() ?? '').toLowerCase();
        const bExt = b.isDirectory ? '' : (b.name.split('.').pop() ?? '').toLowerCase();
        r = aExt.localeCompare(bExt);
        if (r === 0) r = a.name.localeCompare(b.name);
        break;
      }
    }
    return r * dir;
  };
  return [...entries].sort(cmp);
}

// ---------- Grouping ----------

function groupEntries(entries: DirEntry[], sort: FolderSort): { label: string; entries: DirEntry[] }[] {
  if (sort.key === 'name') return [{ label: '', entries }];
  const sections: { label: string; entries: DirEntry[] }[] = [];
  let last: string | null = null;
  for (const e of entries) {
    const label = sectionLabel(e, sort);
    if (label !== last) {
      sections.push({ label, entries: [] });
      last = label;
    }
    sections[sections.length - 1].entries.push(e);
  }
  return sections;
}

function sectionLabel(entry: DirEntry, sort: FolderSort): string {
  if (sort.foldersFirst && entry.isDirectory) return 'Folders';
  switch (sort.key) {
    case 'modified':
      return labelForDate(entry.mtimeMs);
    case 'created':
      return labelForDate(entry.ctimeMs);
    case 'size':
      return labelForSize(entry.size);
    case 'type':
      return labelForKind(entry);
    default:
      return '';
  }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function labelForDate(ms: number): string {
  if (!ms) return 'Unknown date';
  const date = new Date(ms);
  const today = startOfDay(new Date()).getTime();
  const day = 86_400_000;
  const ts = date.getTime();
  if (ts >= today) return 'Today';
  if (ts >= today - day) return 'Yesterday';
  if (ts >= today - 7 * day) return 'Earlier this week';
  if (ts >= today - 14 * day) return 'Last week';
  const now = new Date();
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth())
    return 'This month';
  if (date.getFullYear() === now.getFullYear()) return 'Earlier this year';
  return `${date.getFullYear()}`;
}

function labelForSize(bytes: number): string {
  if (bytes === 0) return 'Empty';
  if (bytes < 10 * 1024) return 'Tiny (< 10 KB)';
  if (bytes < 100 * 1024) return 'Small (< 100 KB)';
  if (bytes < 1024 * 1024) return 'Medium (< 1 MB)';
  if (bytes < 10 * 1024 * 1024) return 'Large (< 10 MB)';
  if (bytes < 100 * 1024 * 1024) return 'Huge (< 100 MB)';
  return 'Massive (≥ 100 MB)';
}

function labelForKind(entry: DirEntry): string {
  if (entry.isDirectory) return 'Folders';
  const dot = entry.name.lastIndexOf('.');
  if (dot < 1) return 'No extension';
  return entry.name.slice(dot + 1).toUpperCase();
}

// ---------- Sort menu ----------

const SORT_OPTIONS: { key: FolderSortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'modified', label: 'Date Modified' },
  { key: 'created', label: 'Date Created' },
  { key: 'size', label: 'Size' },
  { key: 'type', label: 'Kind' },
];

function SortMenu({
  sort,
  onChange,
}: {
  sort: FolderSort;
  onChange: (next: FolderSort) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('.folder-sort-menu') || t?.closest('.folder-sort-btn')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [open]);

  const currentLabel = SORT_OPTIONS.find((o) => o.key === sort.key)?.label ?? sort.key;

  const setKey = (key: FolderSortKey) => {
    onChange({ ...sort, key });
  };
  const setDir = (direction: SortDirection) => {
    onChange({ ...sort, direction });
  };

  return (
    <div className="folder-sort" ref={wrapRef}>
      <button
        className="folder-sort-btn"
        onClick={() => setOpen((v) => !v)}
        title="Sort options"
      >
        {currentLabel} {sort.direction === 'asc' ? '↑' : '↓'}
      </button>
      {open && (
        <div className="folder-sort-menu" onMouseDown={(e) => e.stopPropagation()}>
          <div className="folder-sort-section">Sort by</div>
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.key}
              className={`folder-sort-item ${sort.key === o.key ? 'folder-sort-item--active' : ''}`}
              onClick={() => setKey(o.key)}
            >
              {o.label}
            </button>
          ))}
          <div className="folder-sort-sep" />
          <div className="folder-sort-section">Order</div>
          <button
            className={`folder-sort-item ${sort.direction === 'asc' ? 'folder-sort-item--active' : ''}`}
            onClick={() => setDir('asc')}
          >
            Ascending ↑
          </button>
          <button
            className={`folder-sort-item ${sort.direction === 'desc' ? 'folder-sort-item--active' : ''}`}
            onClick={() => setDir('desc')}
          >
            Descending ↓
          </button>
          <div className="folder-sort-sep" />
          <label className="folder-sort-toggle">
            <input
              type="checkbox"
              checked={sort.foldersFirst}
              onChange={(e) => onChange({ ...sort, foldersFirst: e.target.checked })}
            />
            <span>Folders first</span>
          </label>
        </div>
      )}
    </div>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
      <path
        d={dir === 'left' ? 'M10 3 L5 8 L10 13' : 'M6 3 L11 8 L6 13'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Breadcrumb({
  segments,
  folderPath,
  onNavigate,
}: {
  segments: string[];
  folderPath: string;
  onNavigate: (path: string) => void;
}) {
  const isAbsolute = folderPath.startsWith('/');
  const crumbs = segments.map((name, i) => {
    const path = (isAbsolute ? '/' : '') + segments.slice(0, i + 1).join('/');
    return { name, path };
  });
  return (
    <div className="folder-crumbs">
      {isAbsolute && <span className="folder-crumb folder-crumb--root">/</span>}
      {crumbs.map((c, i) => (
        <span key={c.path} className="folder-crumb-wrap">
          <button
            className={`folder-crumb ${i === crumbs.length - 1 ? 'folder-crumb--current' : ''}`}
            onClick={() => i < crumbs.length - 1 && onNavigate(c.path)}
            disabled={i === crumbs.length - 1}
          >
            {c.name}
          </button>
          {i < crumbs.length - 1 && <span className="folder-crumb-sep">/</span>}
        </span>
      ))}
    </div>
  );
}

function FolderItem({
  entry,
  onClick,
  onDoubleClick,
  onContextMenu,
  selected,
  cut,
  dropTarget,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: ItemProps) {
  return (
    <button
      data-path={entry.path}
      className={
        `folder-item${selected ? ' folder-item--selected' : ''}` +
        (cut ? ' folder-item--cut' : '') +
        (dropTarget ? ' folder-item--drop-target' : '')
      }
      draggable
      onClick={(e) => onClick(e)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      title={entry.path}
    >
      <div className="folder-item-icon">
        <FileIcon entry={entry} />
      </div>
      <div className="folder-item-name">{entry.name}</div>
    </button>
  );
}

function FileIcon({ entry }: { entry: DirEntry }) {
  if (entry.isDirectory) {
    return (
      <svg viewBox="0 0 32 32" width={56} height={56} aria-hidden>
        <path
          d="M3 8 a2 2 0 0 1 2 -2 h7 l3 3 h12 a2 2 0 0 1 2 2 v15 a2 2 0 0 1 -2 2 h-22 a2 2 0 0 1 -2 -2 z"
          fill="currentColor"
          opacity="0.85"
        />
      </svg>
    );
  }

  const ext = (entry.name.split('.').pop() ?? '').toLowerCase();
  if (PREVIEWABLE_IMAGE_EXTS.has(ext)) {
    return <ImageThumb path={entry.path} />;
  }

  const kind = detectKind(entry.path);
  const badge =
    kind === 'markdown'
      ? 'MD'
      : kind === 'binary'
        ? 'BIN'
        : ext.length <= 4 && ext.length > 0
          ? ext.toUpperCase()
          : 'TXT';
  return (
    <svg viewBox="0 0 56 64" width={48} height={56} aria-hidden>
      <path
        d="M6 4 h32 l12 12 v44 a4 4 0 0 1 -4 4 h-40 a4 4 0 0 1 -4 -4 v-52 a4 4 0 0 1 4 -4 z"
        fill="currentColor"
        opacity="0.12"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="1.4"
      />
      <path d="M38 4 v12 h12" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.4" />
      <text
        x="28"
        y="46"
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fontFamily="-apple-system, sans-serif"
        fill="currentColor"
      >
        {badge}
      </text>
    </svg>
  );
}

function FolderContextMenu({
  x,
  y,
  entry,
  onClose,
  onOpen,
  onOpenDefault,
  onQuickLook,
  onOpenAsWorkspace,
  onBookmark,
  onCopyPath,
  onCopyName,
  onReveal,
  onRename,
  onCompare,
  onTrash,
}: {
  x: number;
  y: number;
  entry: DirEntry;
  onClose: () => void;
  onOpen: () => void;
  onOpenDefault: () => void;
  onQuickLook: () => void;
  onOpenAsWorkspace: () => void;
  onBookmark: () => void;
  onCopyPath: () => void;
  onCopyName: () => void;
  onReveal: () => void;
  onRename: () => void;
  onCompare: () => void;
  onTrash: () => void;
}) {
  const wrap = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <div
      className="ctx-menu"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button className="ctx-menu-item" onClick={wrap(onOpen)}>
        Open
      </button>
      {!entry.isDirectory && (
        <button className="ctx-menu-item" onClick={wrap(onQuickLook)}>
          Quick Look <span className="ctx-menu-kbd">space</span>
        </button>
      )}
      <button className="ctx-menu-item" onClick={wrap(onOpenDefault)}>
        Open in Default App
      </button>
      {entry.isDirectory && (
        <>
          <div className="ctx-menu-sep" />
          <button className="ctx-menu-item" onClick={wrap(onOpenAsWorkspace)}>
            Open as Workspace
          </button>
          <button className="ctx-menu-item" onClick={wrap(onBookmark)}>
            Bookmark Folder
          </button>
        </>
      )}
      <div className="ctx-menu-sep" />
      <button className="ctx-menu-item" onClick={wrap(onCopyPath)}>
        Copy Path
      </button>
      <button className="ctx-menu-item" onClick={wrap(onCopyName)}>
        Copy Name
      </button>
      <button className="ctx-menu-item" onClick={wrap(onReveal)}>
        Reveal in Finder
      </button>
      {!entry.isDirectory && (
        <button className="ctx-menu-item" onClick={wrap(onCompare)}>
          Compare With…
        </button>
      )}
      <div className="ctx-menu-sep" />
      <button className="ctx-menu-item" onClick={wrap(onRename)}>
        Rename…
      </button>
      <button className="ctx-menu-item ctx-menu-item--danger" onClick={wrap(onTrash)}>
        Move to Trash
      </button>
    </div>
  );
}

function FolderBgContextMenu({
  x,
  y,
  canPaste,
  onClose,
  onNewFile,
  onNewFolder,
  onPaste,
  onReveal,
  onRefresh,
  onOpenAsWorkspace,
}: {
  x: number;
  y: number;
  canPaste: boolean;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onPaste: () => void;
  onReveal: () => void;
  onRefresh: () => void;
  onOpenAsWorkspace: () => void;
}) {
  const wrap = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <div
      className="ctx-menu"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button className="ctx-menu-item" onClick={wrap(onNewFolder)}>
        New Folder…
      </button>
      <button className="ctx-menu-item" onClick={wrap(onNewFile)}>
        New File…
      </button>
      <div className="ctx-menu-sep" />
      <button
        className="ctx-menu-item"
        onClick={wrap(onPaste)}
        disabled={!canPaste}
        style={!canPaste ? { opacity: 0.4, cursor: 'default' } : undefined}
      >
        Paste <span className="ctx-menu-kbd">⌘V</span>
      </button>
      <div className="ctx-menu-sep" />
      <button className="ctx-menu-item" onClick={wrap(onRefresh)}>
        Refresh
      </button>
      <button className="ctx-menu-item" onClick={wrap(onReveal)}>
        Reveal in Finder
      </button>
      <button className="ctx-menu-item" onClick={wrap(onOpenAsWorkspace)}>
        Open as Workspace
      </button>
    </div>
  );
}

function ImageThumb({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.marko.loadImage(path).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!src) {
    return (
      <div className="folder-item-thumb folder-item-thumb--loading">
        <span>IMG</span>
      </div>
    );
  }
  return (
    <div className="folder-item-thumb">
      <img src={src} alt="" loading="lazy" />
    </div>
  );
}
