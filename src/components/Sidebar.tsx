import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace, workspace, getActiveSession } from '../state/workspace';
import { openFolderViaDialog, openFileFromPath, openFolderInEditor } from '../lib/actions';
import { settings, useSettings } from '../state/settings';
import type { DirEntry } from '../types/marko';

type EditMode = 'rename' | 'new-file' | 'new-folder';
interface EditState {
  mode: EditMode;
  // For rename: the path being renamed.
  // For new-file/new-folder: the parent directory path (a placeholder row is rendered inside).
  target: string;
  initial: string;
}

interface VisibleNode {
  path: string;
  name: string;
  isDirectory: boolean;
  depth: number;
  parent: string | null;
  // marker used for placeholder rows during create
  placeholderUnder?: string;
  placeholderKind?: 'file' | 'folder';
}

const ROW_HEIGHT = 24;

export function Sidebar() {
  const rootDir = useWorkspace((s) => getActiveSession(s).rootDir);
  const revealPath = useWorkspace((s) => s.revealPath);
  const revealToken = useWorkspace((s) => s.revealToken);
  const showHidden = useSettings().showHiddenFiles;

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [entriesMap, setEntriesMap] = useState<Map<string, DirEntry[]>>(() => new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; isDirectory: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const treeRef = useRef<HTMLDivElement | null>(null);
  // Held single-click action; cleared if a double-click arrives within ~220ms.
  const pendingClickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingClick = () => {
    if (pendingClickRef.current) {
      clearTimeout(pendingClickRef.current);
      pendingClickRef.current = null;
    }
  };
  useEffect(() => () => cancelPendingClick(), []);

  // When rootDir changes, reset state and load root.
  useEffect(() => {
    if (!rootDir) return;
    setExpanded(new Set([rootDir]));
    setEntriesMap(new Map());
    setSelected(null);
    setEdit(null);
    void loadDir(rootDir);
  }, [rootDir]);

  const loadDir = useCallback(async (dir: string) => {
    try {
      const entries = await window.marko.listDir(dir);
      setEntriesMap((m) => {
        const next = new Map(m);
        next.set(dir, entries);
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const refreshDir = useCallback(
    async (dir: string) => {
      await loadDir(dir);
    },
    [loadDir],
  );

  // Build the flat visible list.
  const visible = useMemo<VisibleNode[]>(() => {
    if (!rootDir) return [];
    const out: VisibleNode[] = [];
    const walk = (dir: string, depth: number, parent: string | null) => {
      const all = entriesMap.get(dir);
      if (!all) return;
      const entries = showHidden ? all : all.filter((e) => !e.name.startsWith('.'));
      for (const e of entries) {
        out.push({
          path: e.path,
          name: e.name,
          isDirectory: e.isDirectory,
          depth,
          parent: dir,
        });
        if (e.isDirectory && expanded.has(e.path)) walk(e.path, depth + 1, dir);
      }
      if (edit && (edit.mode === 'new-file' || edit.mode === 'new-folder') && edit.target === dir) {
        out.push({
          path: `${dir}/__new__`,
          name: '',
          isDirectory: edit.mode === 'new-folder',
          depth,
          parent: dir,
          placeholderUnder: dir,
          placeholderKind: edit.mode === 'new-file' ? 'file' : 'folder',
        });
      }
    };
    walk(rootDir, 0, null);
    return out;
  }, [rootDir, entriesMap, expanded, edit, showHidden]);

  // Lazy-load children of expanded folders.
  useEffect(() => {
    for (const path of expanded) {
      if (!entriesMap.has(path)) void loadDir(path);
    }
  }, [expanded, entriesMap, loadDir]);

  // Reveal scroll: center the row when revealToken bumps. Tracks pending so
  // it survives lazy-load races (effect re-fires when visible grows).
  const pendingRevealRef = useRef<{ token: number; path: string } | null>(null);
  useEffect(() => {
    if (!revealPath || revealToken === 0) return;
    pendingRevealRef.current = { token: revealToken, path: revealPath };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealToken]);

  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending) return;
    const idx = visible.findIndex((v) => v.path === pending.path);
    if (idx < 0) return;
    const row = treeRef.current?.querySelector<HTMLElement>(`[data-row-index="${idx}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    pendingRevealRef.current = null;
  }, [visible, revealToken]);

  // Cancel edit on Escape, commit on Enter — handled in input.

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectIndex = (i: number) => {
    if (visible.length === 0) return;
    const idx = Math.max(0, Math.min(visible.length - 1, i));
    const node = visible[idx];
    if (!node) return;
    setSelected(node.path);
    // Keep arrow-navigated row visible without racing the reveal-center scroll.
    requestAnimationFrame(() => {
      const row = treeRef.current?.querySelector<HTMLElement>(
        `[data-row-index="${idx}"]`,
      );
      row?.scrollIntoView({ block: 'nearest' });
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (edit) return; // editing input handles keys
    const idx = selected ? visible.findIndex((v) => v.path === selected) : 0;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectIndex(idx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectIndex(Math.max(0, idx - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const cur = visible[idx];
      if (!cur) return;
      if (cur.isDirectory) {
        if (!expanded.has(cur.path)) toggleExpand(cur.path);
        else selectIndex(idx + 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const cur = visible[idx];
      if (!cur) return;
      if (cur.isDirectory && expanded.has(cur.path)) {
        toggleExpand(cur.path);
      } else if (cur.parent) {
        const parentIdx = visible.findIndex((v) => v.path === cur.parent);
        if (parentIdx >= 0) selectIndex(parentIdx);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cur = visible[idx];
      if (!cur) return;
      if (cur.isDirectory) void openFolderInEditor(cur.path, { focus: true });
      else void openFileFromPath(cur.path, { focus: true });
    } else if (e.key === 'F2') {
      e.preventDefault();
      const cur = visible[idx];
      if (cur) startRename(cur.path, cur.name);
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const cur = visible[idx];
      if (cur) void doTrash(cur.path);
    } else if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const cur = visible[idx];
      if (!cur) return;
      e.preventDefault();
      const parent = cur.isDirectory && expanded.has(cur.path) ? cur.path : cur.parent ?? rootDir;
      if (parent) {
        if (e.shiftKey) startCreate(parent, 'new-folder');
        else startCreate(parent, 'new-file');
      }
    }
  };

  const startRename = (path: string, currentName: string) => {
    setEdit({ mode: 'rename', target: path, initial: currentName });
  };

  const startCreate = (parent: string, mode: 'new-file' | 'new-folder') => {
    if (!expanded.has(parent)) {
      setExpanded((prev) => new Set(prev).add(parent));
    }
    setEdit({ mode, target: parent, initial: '' });
  };

  const cancelEdit = () => setEdit(null);

  const commitEdit = async (value: string) => {
    if (!edit) return;
    const trimmed = value.trim();
    if (!trimmed) {
      cancelEdit();
      return;
    }
    if (edit.mode === 'rename') {
      const oldPath = edit.target;
      const lastSlash = oldPath.lastIndexOf('/');
      const newPath = oldPath.slice(0, lastSlash + 1) + trimmed;
      if (newPath === oldPath) {
        cancelEdit();
        return;
      }
      const result = await window.marko.rename(oldPath, newPath);
      if (!result.ok) {
        setError(result.error ?? 'rename failed');
        return;
      }
      // refresh parent
      const parent = oldPath.slice(0, lastSlash);
      await refreshDir(parent);
      setSelected(newPath);
      cancelEdit();
    } else {
      const parent = edit.target;
      const newPath = `${parent}/${trimmed}`;
      const result =
        edit.mode === 'new-file'
          ? await window.marko.createFile(newPath)
          : await window.marko.createDir(newPath);
      if (!result.ok) {
        setError(result.error ?? 'create failed');
        return;
      }
      await refreshDir(parent);
      setSelected(newPath);
      cancelEdit();
      if (edit.mode === 'new-file') void openFileFromPath(newPath);
    }
  };

  const doTrash = async (path: string) => {
    const ok = window.confirm(`Move "${basename(path)}" to Trash?`);
    if (!ok) return;
    const result = await window.marko.trash(path);
    if (!result.ok) {
      setError(result.error ?? 'trash failed');
      return;
    }
    const parent = path.slice(0, path.lastIndexOf('/'));
    await refreshDir(parent);
    if (selected === path) setSelected(null);
  };

  const onContextMenu = (e: React.MouseEvent, node: VisibleNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (node) setSelected(node.path);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      path: node?.path ?? rootDir ?? '',
      isDirectory: node ? node.isDirectory : true,
    });
  };

  // Close menu on any click outside (or any keydown).
  useEffect(() => {
    if (!menu) return;
    const onDocMouse = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('.ctx-menu')) return; // ignore clicks within the menu
      setMenu(null);
    };
    const onDocKey = () => setMenu(null);
    document.addEventListener('mousedown', onDocMouse, true);
    document.addEventListener('keydown', onDocKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocMouse, true);
      document.removeEventListener('keydown', onDocKey, true);
    };
  }, [menu]);

  const toggleSidebar = useCallback(() => workspace.toggleSidebar(), []);

  // Reveal a path: expand all ancestor directories under rootDir and select it.
  // Lazy-loading still applies — the existing expanded-effect will fetch
  // contents for newly-expanded dirs, and the visible list rebuilds when ready.
  useEffect(() => {
    if (!revealPath || !rootDir) return;
    if (revealPath !== rootDir && !revealPath.startsWith(rootDir + '/')) return;
    const ancestors = new Set<string>();
    ancestors.add(rootDir);
    if (revealPath !== rootDir) {
      let p = revealPath;
      while (p.length > rootDir.length) {
        const slash = p.lastIndexOf('/');
        if (slash <= 0) break;
        p = p.slice(0, slash);
        ancestors.add(p);
        if (p === rootDir) break;
      }
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      ancestors.forEach((a) => next.add(a));
      return next;
    });
    setSelected(revealPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealToken]);

  return (
    <div className="sidebar-inner">
      <div className="sidebar-header">
        <WorkspaceDropdown rootDir={rootDir} />
        <div className="sidebar-actions">
          <IconBtn
            label="Open Folder…"
            onClick={() => void openFolderViaDialog()}
            kbd="⌘⇧O"
          >
            <IconFolderOpen />
          </IconBtn>
          <IconBtn
            label={showHidden ? 'Hide hidden files' : 'Show hidden files'}
            onClick={() => settings.update({ showHiddenFiles: !showHidden })}
            active={showHidden}
          >
            {showHidden ? <IconEye /> : <IconEyeOff />}
          </IconBtn>
          {/* Sidebar visibility is now toggled from the leftmost
              pane's tab bar (TabBar.tsx → SidebarRevealButton). One
              button stays in the same place whether the panel is open
              or closed, so toggling doesn't visibly shift it. */}
        </div>
      </div>
      <div
        ref={treeRef}
        className="sidebar-tree"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => onContextMenu(e, null)}
      >
        {!rootDir && <div className="sidebar-empty">Open a folder to browse files.</div>}
        {rootDir &&
          visible.map((node, i) => (
            <TreeRow
              key={node.path}
              node={node}
              index={i}
              expanded={expanded.has(node.path)}
              selected={selected === node.path}
              editing={
                edit && edit.mode === 'rename' && edit.target === node.path
                  ? edit
                  : node.placeholderUnder && edit && (edit.mode === 'new-file' || edit.mode === 'new-folder')
                    ? edit
                    : null
              }
              onClick={() => {
                setSelected(node.path);
                if (node.isDirectory) {
                  // Defer the toggle so a double-click can cancel it.
                  // Click the chevron for instant toggling without delay.
                  cancelPendingClick();
                  pendingClickRef.current = setTimeout(() => {
                    toggleExpand(node.path);
                    pendingClickRef.current = null;
                  }, 220);
                } else {
                  void openFileFromPath(node.path, { focus: false });
                }
              }}
              onDoubleClick={() => {
                cancelPendingClick();
                if (node.isDirectory) {
                  void openFolderInEditor(node.path, { focus: true });
                } else {
                  void openFileFromPath(node.path, { focus: true });
                }
              }}
              onContextMenu={(e) => onContextMenu(e, node)}
              onTwistClick={(e) => {
                e.stopPropagation();
                if (node.isDirectory) toggleExpand(node.path);
              }}
              onCommit={commitEdit}
              onCancel={cancelEdit}
            />
          ))}
        {error && <div className="sidebar-error">{error}</div>}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          isDirectory={menu.isDirectory}
          path={menu.path}
          onClose={() => setMenu(null)}
          onNewFile={() => {
            const parent = menu.isDirectory ? menu.path : menu.path.slice(0, menu.path.lastIndexOf('/'));
            startCreate(parent, 'new-file');
          }}
          onNewFolder={() => {
            const parent = menu.isDirectory ? menu.path : menu.path.slice(0, menu.path.lastIndexOf('/'));
            startCreate(parent, 'new-folder');
          }}
          onRename={() => {
            startRename(menu.path, basename(menu.path));
          }}
          onTrash={() => void doTrash(menu.path)}
          onCopyPath={() => void navigator.clipboard.writeText(menu.path)}
          onReveal={() => void window.marko.revealInFinder(menu.path)}
          onOpenAsWorkspace={() => workspace.setRootDir(menu.path)}
          onBookmark={() => {
            const cur = settings.get();
            if (cur.workspaceBookmarks.some((b) => b.path === menu.path)) return;
            settings.update({
              workspaceBookmarks: [
                ...cur.workspaceBookmarks,
                { name: basename(menu.path), path: menu.path },
              ],
            });
          }}
        />
      )}
    </div>
  );
}

function TreeRow({
  node,
  index,
  expanded,
  selected,
  editing,
  onClick,
  onDoubleClick,
  onContextMenu,
  onTwistClick,
  onCommit,
  onCancel,
}: {
  node: VisibleNode;
  index: number;
  expanded: boolean;
  selected: boolean;
  editing: EditState | null;
  onClick: () => void;
  onDoubleClick?: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onTwistClick: (e: React.MouseEvent) => void;
  onCommit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const isPlaceholder = !!node.placeholderUnder;
  const isEditing = editing != null && (
    (editing.mode === 'rename' && editing.target === node.path) ||
    (isPlaceholder && (editing.mode === 'new-file' || editing.mode === 'new-folder'))
  );

  if (isEditing) {
    return (
      <RowEditor
        depth={node.depth}
        isDirectory={node.isDirectory}
        initial={editing!.initial}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }

  return (
    <div
      data-row-index={index}
      className={`tree-row ${node.isDirectory ? '' : 'tree-row--file'} ${selected ? 'tree-row--selected' : ''}`}
      style={{ paddingLeft: 8 + node.depth * 12 }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title={node.path}
    >
      {node.isDirectory ? (
        <span className="tree-twist" onClick={onTwistClick}>
          {expanded ? '▾' : '▸'}
        </span>
      ) : (
        <span className="tree-twist tree-twist--blank" />
      )}
      <span className="tree-name">{node.name}</span>
    </div>
  );
}

function RowEditor({
  depth,
  isDirectory,
  initial,
  onCommit,
  onCancel,
}: {
  depth: number;
  isDirectory: boolean;
  initial: string;
  onCommit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      // Select up to the file extension for renames so typing replaces the basename.
      if (initial) {
        const dot = initial.lastIndexOf('.');
        if (dot > 0) el.setSelectionRange(0, dot);
        else el.select();
      }
    });
  }, [initial]);

  return (
    <div className="tree-row tree-row--editing" style={{ paddingLeft: 8 + depth * 12 }}>
      <span className="tree-twist tree-twist--blank">{isDirectory ? '▸' : ''}</span>
      <input
        ref={inputRef}
        className="tree-edit-input"
        defaultValue={initial}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void onCommit((e.target as HTMLInputElement).value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={(e) => void onCommit(e.target.value)}
      />
    </div>
  );
}

function ContextMenu({
  x,
  y,
  isDirectory,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onTrash,
  onCopyPath,
  onReveal,
  onOpenAsWorkspace,
  onBookmark,
}: {
  x: number;
  y: number;
  isDirectory: boolean;
  path: string;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onTrash: () => void;
  onCopyPath: () => void;
  onReveal: () => void;
  onOpenAsWorkspace: () => void;
  onBookmark: () => void;
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
      {isDirectory && (
        <>
          <button className="ctx-menu-item" onClick={wrap(onOpenAsWorkspace)}>
            Open as Workspace
          </button>
          <button className="ctx-menu-item" onClick={wrap(onBookmark)}>
            Bookmark Folder
          </button>
          <div className="ctx-menu-sep" />
        </>
      )}
      <button className="ctx-menu-item" onClick={wrap(onNewFile)}>
        New File
      </button>
      <button className="ctx-menu-item" onClick={wrap(onNewFolder)}>
        New Folder
      </button>
      <div className="ctx-menu-sep" />
      <button className="ctx-menu-item" onClick={wrap(onRename)}>
        Rename… <span className="ctx-menu-kbd">F2</span>
      </button>
      <button className="ctx-menu-item ctx-menu-item--danger" onClick={wrap(onTrash)}>
        Move to Trash <span className="ctx-menu-kbd">⌘⌫</span>
      </button>
      <div className="ctx-menu-sep" />
      <button className="ctx-menu-item" onClick={wrap(onCopyPath)}>
        Copy Path
      </button>
      <button className="ctx-menu-item" onClick={wrap(onReveal)}>
        Reveal in Finder
      </button>
    </div>
  );
}

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p;
}

function WorkspaceDropdown({ rootDir }: { rootDir: string | null }) {
  const bookmarks = useSettings().workspaceBookmarks;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Position the menu just below the trigger button.
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 4 });
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('.workspace-dd-menu') || t?.closest('.workspace-dd')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [open]);

  const isCurrentBookmarked = !!rootDir && bookmarks.some((b) => b.path === rootDir);

  const switchTo = (path: string) => {
    setOpen(false);
    workspace.setRootDir(path);
  };

  const addBookmark = () => {
    if (!rootDir) return;
    setOpen(false);
    if (bookmarks.some((b) => b.path === rootDir)) return;
    settings.update({
      workspaceBookmarks: [...bookmarks, { name: basename(rootDir), path: rootDir }],
    });
  };

  const removeBookmark = (path: string) => {
    settings.update({
      workspaceBookmarks: bookmarks.filter((b) => b.path !== path),
    });
  };

  const removeCurrent = () => {
    if (!rootDir) return;
    setOpen(false);
    removeBookmark(rootDir);
  };

  return (
    <div className="workspace-dd">
      <button
        ref={btnRef}
        className={`sidebar-root ${rootDir ? '' : 'sidebar-root--empty'}`}
        title={rootDir ?? 'No folder'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sidebar-root-name">{rootDir ? basename(rootDir) : 'No folder'}</span>
        <span className="sidebar-root-caret">▾</span>
      </button>
      {open && pos && (
        <div
          className="workspace-dd-menu"
          style={{ position: 'fixed', left: pos.left, top: pos.top }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {bookmarks.length > 0 && (
            <>
              <div className="workspace-dd-section">Bookmarks</div>
              {bookmarks.map((b) => (
                <div
                  key={b.path}
                  className={`workspace-dd-item ${rootDir === b.path ? 'workspace-dd-item--active' : ''}`}
                >
                  <button
                    className="workspace-dd-item-main"
                    onClick={() => switchTo(b.path)}
                    title={b.path}
                  >
                    <span className="workspace-dd-item-name">{b.name}</span>
                    <span className="workspace-dd-item-path">{b.path}</span>
                  </button>
                  <button
                    className="workspace-dd-item-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeBookmark(b.path);
                    }}
                    aria-label="Remove bookmark"
                    title="Remove bookmark"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="workspace-dd-sep" />
            </>
          )}
          {rootDir && !isCurrentBookmarked && (
            <button className="workspace-dd-action" onClick={addBookmark}>
              ★ Bookmark current folder
            </button>
          )}
          {rootDir && isCurrentBookmarked && (
            <button className="workspace-dd-action" onClick={removeCurrent}>
              ☆ Remove from bookmarks
            </button>
          )}
          <button
            className="workspace-dd-action"
            onClick={() => {
              setOpen(false);
              void openFolderViaDialog();
            }}
          >
            📁 Open Folder…
          </button>
        </div>
      )}
    </div>
  );
}

function IconBtn({
  label,
  kbd,
  active,
  onClick,
  children,
}: {
  label: string;
  kbd?: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`sidebar-icon-btn ${active ? 'sidebar-icon-btn--active' : ''}`}
      onClick={onClick}
      title={kbd ? `${label} · ${kbd}` : label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function IconFolderOpen() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
      <path
        d="M2 4 a1 1 0 0 1 1 -1 h3.5 l1.5 1.5 h5 a1 1 0 0 1 1 1 v1 h-12 z M2 7 h12 l-1.2 5.2 a1 1 0 0 1 -1 .8 h-9.6 a1 1 0 0 1 -1 -.8 z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconEye() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden fill="none">
      <path
        d="M1.5 8 c1.7 -3.2 4 -4.8 6.5 -4.8 s4.8 1.6 6.5 4.8 c-1.7 3.2 -4 4.8 -6.5 4.8 s-4.8 -1.6 -6.5 -4.8 z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconEyeOff() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden fill="none">
      <path
        d="M1.5 8 c1.7 -3.2 4 -4.8 6.5 -4.8 s4.8 1.6 6.5 4.8 c-1.7 3.2 -4 4.8 -6.5 4.8 s-4.8 -1.6 -6.5 -4.8 z"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.5"
      />
      <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconSidebarPanel({ filled }: { filled?: boolean }) {
  // macOS-style "sidebar panel" pictogram: a rounded rectangle with a thin
  // vertical bar near the left edge representing the panel divider.
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden fill="none">
      <rect
        x="2"
        y="3.5"
        width="12"
        height="9"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect
        x="2.6"
        y="4.1"
        width="3.4"
        height="7.8"
        rx="1.4"
        fill={filled ? 'currentColor' : 'none'}
        opacity={filled ? 0.35 : 1}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth="1.4"
      />
    </svg>
  );
}
