import { useEffect, useMemo, useState } from 'react';
import { type LaterItem, readLater, removeFromLater, subscribeLater } from '../lib/laterStore';
import { openUrlInTab } from '../lib/actions';

/** Date buckets for grouping saved items. Order matters — earlier
 *  buckets in the list win when an item could fit in multiple. */
const BUCKETS: { id: string; label: string; matches: (ageMs: number) => boolean }[] = [
  { id: 'today', label: 'Today', matches: (a) => a < 24 * 3600_000 },
  { id: 'yesterday', label: 'Yesterday', matches: (a) => a < 48 * 3600_000 },
  { id: 'week', label: 'Earlier this week', matches: (a) => a < 7 * 24 * 3600_000 },
  { id: 'month', label: 'This month', matches: (a) => a < 30 * 24 * 3600_000 },
  { id: 'quarter', label: 'Last 3 months', matches: (a) => a < 90 * 24 * 3600_000 },
  { id: 'older', label: 'Older', matches: () => true },
];

/** Group items into the BUCKETS list, preserving newest-first order
 *  inside each bucket. Buckets that end up empty are dropped so the
 *  rendered list doesn't have empty section headings. */
function bucketize(items: LaterItem[]): { id: string; label: string; items: LaterItem[] }[] {
  const now = Date.now();
  const out = BUCKETS.map((b) => ({ id: b.id, label: b.label, items: [] as LaterItem[] }));
  for (const item of items) {
    const age = now - item.savedAt;
    const idx = BUCKETS.findIndex((b) => b.matches(age));
    out[idx === -1 ? out.length - 1 : idx].items.push(item);
  }
  return out.filter((b) => b.items.length > 0);
}

/** "Save for later" tab — list of pages, articles, videos the user
 *  saved via the bookmark button on a web tab. Items are stored in
 *  `~/.marko/later.json` (see `lib/laterStore.ts`); this view just
 *  reads and renders them, listening for the change event so saves
 *  from a web tab show up immediately without a manual refresh. */
export function LaterView() {
  const [items, setItems] = useState<LaterItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await readLater();
      if (!cancelled) {
        setItems(list);
        setLoaded(true);
      }
    })();
    const off = subscribeLater(async () => {
      const list = await readLater();
      setItems(list);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const open = (url: string) => {
    void openUrlInTab(url);
  };

  const remove = async (id: string) => {
    const next = await removeFromLater(id);
    setItems(next);
  };

  const buckets = useMemo(() => bucketize(items), [items]);

  return (
    <div className="later">
      <div className="later-header">
        <h1 className="later-title">Later</h1>
        <div className="later-subtitle">
          {items.length === 0
            ? 'Save pages, articles, and videos from a web tab — they show up here.'
            : `${items.length} saved`}
        </div>
      </div>

      {loaded && items.length === 0 && (
        <div className="later-empty">
          <div className="later-empty-emoji">📌</div>
          <div className="later-empty-line">Nothing saved yet.</div>
          <div className="later-empty-hint">
            Open a web tab and click the bookmark icon next to the address bar to save the
            current page for later.
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="later-scroll">
          {buckets.map((bucket) => (
            <section key={bucket.id} className="later-bucket">
              <h2 className="later-bucket-title">{bucket.label}</h2>
              <ul className="later-list">
                {bucket.items.map((item) => (
                  <li key={item.id} className="later-item">
                    <button className="later-item-main" onClick={() => open(item.url)}>
                      <Favicon item={item} />
                      <div className="later-item-info">
                        <div className="later-item-title" title={item.title}>
                          {item.title}
                        </div>
                        <div className="later-item-meta">
                          <span className="later-item-host">{item.host}</span>
                          <span className="later-item-dot" aria-hidden>
                            ·
                          </span>
                          <span className="later-item-time">{relativeTime(item.savedAt)}</span>
                        </div>
                      </div>
                    </button>
                    <button
                      className="later-item-remove"
                      onClick={() => void remove(item.id)}
                      aria-label="Remove from list"
                      title="Remove"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Favicon({ item }: { item: LaterItem }) {
  const [erroredStored, setErroredStored] = useState(false);
  const [erroredFallback, setErroredFallback] = useState(false);
  if (item.favicon && !erroredStored) {
    return (
      <img
        className="later-item-favicon"
        src={item.favicon}
        alt=""
        width={24}
        height={24}
        loading="lazy"
        decoding="async"
        onError={() => setErroredStored(true)}
      />
    );
  }
  if (!erroredFallback) {
    return (
      <img
        className="later-item-favicon"
        src={`https://${item.host}/favicon.ico`}
        alt=""
        width={24}
        height={24}
        loading="lazy"
        decoding="async"
        onError={() => setErroredFallback(true)}
      />
    );
  }
  return (
    <span className="later-item-favicon later-item-favicon--placeholder" aria-hidden>
      🔗
    </span>
  );
}

/** Human-friendly relative time. Goes from "just now" → minutes →
 *  hours → days, then falls back to a date for anything older than
 *  a week. */
function relativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return 'just now';
  const m = Math.round(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(diff / 3_600_000);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(diff / 86_400_000);
  if (d < 7) return `${d}d ago`;
  return new Date(epochMs).toLocaleDateString();
}
