/** Shared "Save for later" store. Items live in ~/.marko/later.json
 *  via the laterRead / laterWrite IPCs; read-mutate-write happens
 *  here so the WebView's bookmark button and the LaterView tab share
 *  one code path. After every mutation we dispatch the
 *  `marko:later-changed` window event — anything reading the list
 *  (LaterView) listens and re-fetches. */

export interface LaterItem {
  /** Stable id, generated at save time. */
  id: string;
  url: string;
  title: string;
  /** Hostname (`news.ycombinator.com`, `youtube.com`, …) — useful
   *  for the source line under the title. */
  host: string;
  /** Epoch milliseconds when the user saved this. */
  savedAt: number;
  /** Page-declared favicon URL if we managed to capture one (the
   *  WebView reports it via `page-favicon-updated`). Optional;
   *  consumers fall back to the host's `/favicon.ico`. */
  favicon?: string;
}

const CHANGED_EVENT = 'marko:later-changed';

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function readLater(): Promise<LaterItem[]> {
  try {
    const raw = await window.marko.laterRead();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { items?: LaterItem[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

async function writeLater(items: LaterItem[]): Promise<void> {
  await window.marko.laterWrite(JSON.stringify({ items }));
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

/** Add a URL to the list. No-op if the URL is already saved (de-dupe
 *  by URL). Returns the new list. */
export async function saveForLater(input: {
  url: string;
  title: string;
  favicon?: string;
}): Promise<LaterItem[]> {
  const items = await readLater();
  if (items.some((i) => i.url === input.url)) return items;
  const item: LaterItem = {
    id: `later-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    url: input.url,
    title: input.title.trim() || input.url,
    host: hostFromUrl(input.url),
    savedAt: Date.now(),
    favicon: input.favicon,
  };
  // Newest first — most-recently-saved is what the user is most
  // likely to want to revisit.
  const next = [item, ...items];
  await writeLater(next);
  return next;
}

export async function removeFromLater(id: string): Promise<LaterItem[]> {
  const items = await readLater();
  const next = items.filter((i) => i.id !== id);
  if (next.length === items.length) return items;
  await writeLater(next);
  return next;
}

/** Subscribe to changes — pass a callback that re-reads the list. */
export function subscribeLater(fn: () => void): () => void {
  const handler = () => fn();
  window.addEventListener(CHANGED_EVENT, handler);
  return () => window.removeEventListener(CHANGED_EVENT, handler);
}

/** True when the URL is a YouTube watch / live / embed page —
 *  drives whether the WebView shows the music-save button alongside
 *  the bookmark one. */
export function isYoutubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return true;
    if (u.hostname.endsWith('youtube.com')) return true;
    return false;
  } catch {
    return false;
  }
}
