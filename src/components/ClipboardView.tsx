import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEntry } from '../types/marko';
import { workspace } from '../state/workspace';

type KindFilter = 'all' | 'text' | 'image';

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatBytes(n: number | undefined): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Tries to recognize JSON for the side-panel preview. */
function detectTextFlavor(text: string): 'json' | 'url' | 'plain' {
  const trimmed = text.trim();
  if (!trimmed) return 'plain';
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // fall through
    }
  }
  if (/^https?:\/\/\S+$/.test(trimmed) && !trimmed.includes('\n')) return 'url';
  return 'plain';
}

export function ClipboardView() {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<KindFilter>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const refreshLockRef = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshLockRef.current) return;
    refreshLockRef.current = true;
    try {
      const list = await window.marko.clipboardList();
      setEntries(list);
      setActiveId((prev) => {
        if (prev && list.some((e) => e.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } finally {
      refreshLockRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    void window.marko.clipboardGetPaused().then(setPaused);
    const off = window.marko.onClipboardChanged(() => {
      void refresh();
    });
    return off;
  }, [refresh]);

  // Re-render every minute so "Xm ago" stays fresh without redrawing on
  // every tick.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter !== 'all' && e.kind !== filter) return false;
      if (!q) return true;
      if (e.preview.toLowerCase().includes(q)) return true;
      if (e.kind === 'text' && e.text && e.text.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [entries, query, filter]);

  // Group entries: pinned first, then by recency bucket.
  const groups = useMemo(() => {
    const pinned: ClipboardEntry[] = [];
    const today: ClipboardEntry[] = [];
    const earlier: ClipboardEntry[] = [];
    const dayMs = 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - dayMs;
    for (const e of filtered) {
      if (e.pinned) pinned.push(e);
      else if (e.ts >= cutoff) today.push(e);
      else earlier.push(e);
    }
    return { pinned, today, earlier };
  }, [filtered]);

  const active = entries.find((e) => e.id === activeId) ?? null;

  const onCopy = useCallback(async (id: string) => {
    await window.marko.clipboardWrite(id);
  }, []);

  const onTogglePin = useCallback(async (id: string, pinned: boolean) => {
    await window.marko.clipboardPin(id, pinned);
  }, []);

  const onDelete = useCallback(async (id: string) => {
    await window.marko.clipboardDelete(id);
  }, []);

  const onClearAll = useCallback(async () => {
    const ok = await window.marko.confirm({
      message: 'Clear clipboard history?',
      detail: 'Pinned entries are preserved. This cannot be undone.',
      confirmLabel: 'Clear',
      dangerous: true,
    });
    if (!ok) return;
    await window.marko.clipboardClear();
  }, []);

  const onTogglePaused = useCallback(async () => {
    const next = !paused;
    setPaused(next);
    await window.marko.clipboardSetPaused(next);
  }, [paused]);

  /** Open the active entry as its own dedicated tab — text entries become
   *  code/json/markdown tabs (kind picked by content sniffing); image entries
   *  open as a regular image tab streamed from disk. */
  const onOpenAsTab = useCallback(async () => {
    if (!active) return;
    if (active.kind === 'text' && active.text != null) {
      const flavor = detectTextFlavor(active.text);
      const kind = flavor === 'json' ? 'json' : 'code';
      const title = active.text.split('\n', 1)[0].slice(0, 40) || 'Clipboard';
      const tab = workspace.openNewTab({ kind, title });
      workspace.updateContent(tab.id, active.text);
      workspace.requestEditorFocus();
    } else if (active.kind === 'image' && active.imagePath) {
      // The image tab is path-keyed via filePath; the savedContent slot is a
      // marko-file:// URL so the ImageViewer streams from disk rather than
      // base64-decoding.
      workspace.openFileTab(
        active.imagePath,
        `marko-file://stream${encodeURI(active.imagePath)}`,
        `Clipboard ${active.width}×${active.height}`,
        'image',
      );
      workspace.requestEditorFocus();
    }
  }, [active]);

  // Keyboard navigation across the visible list.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filtered.length === 0) return;
      const idx = filtered.findIndex((x) => x.id === activeId);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = filtered[Math.min(filtered.length - 1, Math.max(0, idx) + 1)];
        if (next) setActiveId(next.id);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = filtered[Math.max(0, Math.max(0, idx) - 1)];
        if (next) setActiveId(next.id);
      } else if (e.key === 'Enter' && activeId) {
        e.preventDefault();
        void onCopy(activeId);
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && activeId) {
        e.preventDefault();
        void onDelete(activeId);
      }
    },
    [filtered, activeId, onCopy, onDelete],
  );

  return (
    <div className="clipboard-view" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="clipboard-toolbar">
        <input
          className="clipboard-search"
          value={query}
          placeholder="Filter clipboard history…"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="clipboard-filter">
          {(['all', 'text', 'image'] as KindFilter[]).map((k) => (
            <button
              key={k}
              className={`clipboard-chip${filter === k ? ' clipboard-chip--active' : ''}`}
              onClick={() => setFilter(k)}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="clipboard-toolbar-spacer" />
        <button
          className={`clipboard-toolbar-btn${paused ? ' clipboard-toolbar-btn--paused' : ''}`}
          onClick={onTogglePaused}
          title={paused ? 'Resume capture' : 'Pause capture'}
        >
          {paused ? '▶ Resume' : '❚❚ Pause'}
        </button>
        <button
          className="clipboard-toolbar-btn"
          onClick={() => void onClearAll()}
          title="Clear all (pinned items kept)"
        >
          Clear
        </button>
      </div>
      <div className="clipboard-body">
        <div className="clipboard-list">
          {entries.length === 0 ? (
            <div className="clipboard-empty">
              <div className="clipboard-empty-icon">📋</div>
              <div className="clipboard-empty-title">Clipboard history is empty</div>
              <div className="clipboard-empty-sub">
                Copy text or images anywhere and they'll show up here. Your
                history lives in <code>~/.marko/clipboard.json</code>.
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="clipboard-empty">
              <div className="clipboard-empty-title">No matches</div>
              <div className="clipboard-empty-sub">
                Try a different filter or clear the search.
              </div>
            </div>
          ) : (
            <>
              {groups.pinned.length > 0 && (
                <ClipboardSection
                  label="Pinned"
                  items={groups.pinned}
                  activeId={activeId}
                  onSelect={setActiveId}
                  onCopy={onCopy}
                  onTogglePin={onTogglePin}
                />
              )}
              {groups.today.length > 0 && (
                <ClipboardSection
                  label="Last 24 hours"
                  items={groups.today}
                  activeId={activeId}
                  onSelect={setActiveId}
                  onCopy={onCopy}
                  onTogglePin={onTogglePin}
                />
              )}
              {groups.earlier.length > 0 && (
                <ClipboardSection
                  label="Earlier"
                  items={groups.earlier}
                  activeId={activeId}
                  onSelect={setActiveId}
                  onCopy={onCopy}
                  onTogglePin={onTogglePin}
                />
              )}
            </>
          )}
        </div>
        <ClipboardDetail
          entry={active}
          onCopy={onCopy}
          onTogglePin={onTogglePin}
          onDelete={onDelete}
          onOpenAsTab={onOpenAsTab}
        />
      </div>
    </div>
  );
}

function ClipboardSection({
  label,
  items,
  activeId,
  onSelect,
  onCopy,
  onTogglePin,
}: {
  label: string;
  items: ClipboardEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCopy: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
}) {
  return (
    <div className="clipboard-section">
      <div className="clipboard-section-label">{label}</div>
      {items.map((e) => (
        <ClipboardRow
          key={e.id}
          entry={e}
          active={e.id === activeId}
          onSelect={() => onSelect(e.id)}
          onCopy={() => onCopy(e.id)}
          onTogglePin={() => onTogglePin(e.id, !e.pinned)}
        />
      ))}
    </div>
  );
}

function ClipboardRow({
  entry,
  active,
  onSelect,
  onCopy,
  onTogglePin,
}: {
  entry: ClipboardEntry;
  active: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onTogglePin: () => void;
}) {
  const lines = entry.kind === 'text' ? (entry.text?.split('\n').length ?? 0) : 0;
  return (
    <div
      className={`clipboard-row${active ? ' clipboard-row--active' : ''}`}
      onClick={onSelect}
      onDoubleClick={onCopy}
    >
      <div className="clipboard-row-glyph">{entry.kind === 'image' ? '🖼' : '✎'}</div>
      <div className="clipboard-row-main">
        <div className="clipboard-row-preview">{entry.preview || '(empty)'}</div>
        <div className="clipboard-row-meta">
          <span>{timeAgo(entry.ts)}</span>
          <span className="clipboard-row-dot">·</span>
          <span>{entry.kind === 'image' ? formatBytes(entry.byteSize) : `${lines} ${lines === 1 ? 'line' : 'lines'}`}</span>
          {entry.byteSize != null && entry.kind === 'text' && (
            <>
              <span className="clipboard-row-dot">·</span>
              <span>{formatBytes(entry.byteSize)}</span>
            </>
          )}
        </div>
      </div>
      <button
        className={`clipboard-row-pin${entry.pinned ? ' clipboard-row-pin--on' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        title={entry.pinned ? 'Unpin' : 'Pin'}
        aria-label={entry.pinned ? 'Unpin entry' : 'Pin entry'}
      >
        {entry.pinned ? '★' : '☆'}
      </button>
    </div>
  );
}

function ClipboardDetail({
  entry,
  onCopy,
  onTogglePin,
  onDelete,
  onOpenAsTab,
}: {
  entry: ClipboardEntry | null;
  onCopy: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  onOpenAsTab: () => void;
}) {
  const [justCopied, setJustCopied] = useState(false);

  useEffect(() => {
    setJustCopied(false);
  }, [entry?.id]);

  if (!entry) {
    return (
      <div className="clipboard-detail clipboard-detail--empty">
        <div className="clipboard-empty-sub">Select an entry to preview.</div>
      </div>
    );
  }

  const flavor = entry.kind === 'text' ? detectTextFlavor(entry.text ?? '') : null;
  const formattedJson =
    flavor === 'json' && entry.text
      ? (() => {
          try {
            return JSON.stringify(JSON.parse(entry.text), null, 2);
          } catch {
            return entry.text;
          }
        })()
      : null;
  const displayText = formattedJson ?? entry.text ?? '';

  const copy = async () => {
    await onCopy(entry.id);
    setJustCopied(true);
    window.setTimeout(() => setJustCopied(false), 1200);
  };

  return (
    <div className="clipboard-detail">
      <div className="clipboard-detail-toolbar">
        <button className="clipboard-detail-btn clipboard-detail-btn--primary" onClick={() => void copy()}>
          {justCopied ? '✓ Copied' : 'Copy back'}
        </button>
        <button
          className="clipboard-detail-btn"
          onClick={() => onTogglePin(entry.id, !entry.pinned)}
        >
          {entry.pinned ? '★ Pinned' : '☆ Pin'}
        </button>
        <button className="clipboard-detail-btn" onClick={() => void onOpenAsTab()}>
          Open as tab
        </button>
        <div className="clipboard-toolbar-spacer" />
        <button className="clipboard-detail-btn" onClick={() => onDelete(entry.id)}>
          Delete
        </button>
      </div>
      <div className="clipboard-detail-meta">
        <span>{new Date(entry.ts).toLocaleString()}</span>
        <span className="clipboard-row-dot">·</span>
        <span>
          {entry.kind === 'image'
            ? `${entry.width}×${entry.height} · ${formatBytes(entry.byteSize)}`
            : `${(entry.text ?? '').length} chars · ${formatBytes(entry.byteSize)}`}
        </span>
        {flavor && flavor !== 'plain' && (
          <>
            <span className="clipboard-row-dot">·</span>
            <span className="clipboard-flavor-tag">{flavor}</span>
          </>
        )}
      </div>
      <div className="clipboard-detail-body">
        {entry.kind === 'image' && entry.imagePath ? (
          <img
            className="clipboard-detail-image"
            src={`marko-file://stream${encodeURI(entry.imagePath)}`}
            alt="Clipboard image"
          />
        ) : (
          <pre className={`clipboard-detail-text${flavor === 'json' ? ' clipboard-detail-text--json' : ''}`}>
            {displayText || '(empty)'}
          </pre>
        )}
      </div>
    </div>
  );
}
