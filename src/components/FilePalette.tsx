import { useEffect, useMemo, useRef, useState } from 'react';
import { Fzf, byLengthAsc, type FzfResultItem } from 'fzf';
import { useWorkspace } from '../state/workspace';
import { openFileFromPath, withReplace } from '../lib/actions';

interface Props {
  open: boolean;
  replace?: boolean;
  onClose: () => void;
}

interface Item {
  path: string;
  rel: string;
  name: string;
}

const MAX_RESULTS = 60;

export function FilePalette({ open, replace = false, onClose }: Props) {
  const rootDir = useWorkspace((s) => s.rootDir);
  const [items, setItems] = useState<Item[] | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastWalkedDir = useRef<string | null>(null);

  // Invalidate any cached index the moment the workspace root changes.
  useEffect(() => {
    setItems(null);
    lastWalkedDir.current = null;
  }, [rootDir]);

  // Walk directory the first time the palette opens (or when rootDir changes).
  useEffect(() => {
    if (!open || !rootDir) return;
    if (lastWalkedDir.current === rootDir && items) return;
    setLoading(true);
    setItems(null);
    let cancelled = false;
    window.marko
      .walkDir(rootDir)
      .then((paths) => {
        if (cancelled) return;
        const rootPrefix = rootDir.endsWith('/') ? rootDir : rootDir + '/';
        const built: Item[] = paths.map((p) => {
          const rel = p.startsWith(rootPrefix) ? p.slice(rootPrefix.length) : p;
          const slash = rel.lastIndexOf('/');
          const name = slash < 0 ? rel : rel.slice(slash + 1);
          return { path: p, rel, name };
        });
        setItems(built);
        lastWalkedDir.current = rootDir;
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, rootDir]);

  // Reset state on open.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Hard-filter to the current workspace. Belt-and-suspenders: walkDir only
  // returns paths under rootDir, but if a workspace switch races with an
  // in-flight walk we never want a stale path to surface in suggestions.
  const scopedItems = useMemo(() => {
    if (!items || !rootDir) return null;
    const prefix = rootDir.endsWith('/') ? rootDir : rootDir + '/';
    return items.filter((it) => it.path === rootDir || it.path.startsWith(prefix));
  }, [items, rootDir]);

  const fzf = useMemo(() => {
    if (!scopedItems) return null;
    return new Fzf(scopedItems, {
      selector: (it) => it.rel,
      tiebreakers: [byLengthAsc],
      limit: MAX_RESULTS,
    });
  }, [scopedItems]);

  const results: FzfResultItem<Item>[] = useMemo(() => {
    if (!fzf || !scopedItems) return [];
    if (!query) {
      return scopedItems.slice(0, MAX_RESULTS).map(
        (it) =>
          ({
            item: it,
            positions: new Set<number>(),
            start: 0,
            end: 0,
            score: 0,
          } as FzfResultItem<Item>),
      );
    }
    return fzf.find(query);
  }, [fzf, scopedItems, query]);

  // Keep activeIndex in bounds.
  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(Math.max(0, results.length - 1));
  }, [results.length, activeIndex]);

  // Scroll active row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const choose = (idx: number) => {
    const item = results[idx]?.item;
    if (!item) return;
    onClose();
    if (replace) void withReplace(() => openFileFromPath(item.path));
    else void openFileFromPath(item.path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(activeIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder={
            rootDir
              ? replace
                ? 'Search files — replaces current tab…'
                : 'Search files…'
              : 'No folder open. Open one with ⌘⇧O.'
          }
          disabled={!rootDir}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="palette-results" ref={listRef}>
          {loading && <div className="palette-empty">Indexing…</div>}
          {!loading && rootDir && results.length === 0 && (
            <div className="palette-empty">No matches.</div>
          )}
          {!loading &&
            results.map((r, i) => (
              <PaletteRow
                key={r.item.path}
                item={r.item}
                positions={r.positions}
                index={i}
                active={i === activeIndex}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => choose(i)}
              />
            ))}
        </div>
        <div className="palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
          {scopedItems && <span className="palette-count">{scopedItems.length} files</span>}
        </div>
      </div>
    </div>
  );
}

function PaletteRow({
  item,
  positions,
  index,
  active,
  onMouseEnter,
  onClick,
}: {
  item: Item;
  positions: Set<number>;
  index: number;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  const dir = item.rel.includes('/') ? item.rel.slice(0, item.rel.lastIndexOf('/')) : '';
  return (
    <div
      data-index={index}
      className={`palette-row ${active ? 'palette-row--active' : ''}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <div className="palette-row-name">{highlight(item.name, positions, item.rel.length - item.name.length)}</div>
      {dir && <div className="palette-row-dir">{highlight(dir, positions, 0)}</div>}
    </div>
  );
}

function highlight(text: string, positions: Set<number>, offset: number) {
  if (!positions.size) return text;
  const out: React.ReactNode[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const matched = positions.has(i + offset);
    if (matched) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      out.push(
        <span key={i} className="palette-match">
          {text[i]}
        </span>,
      );
    } else {
      buf += text[i];
    }
  }
  if (buf) out.push(buf);
  return out;
}
