/** Shared mutator for the music library file (~/.marko/music-library.json).
 *  Lets the WebView's ♫ button and the MusicView tab append tracks
 *  without duplicating the read-write-emit dance. Consumers listen
 *  for the `marko:music-library-changed` window event. */

const CHANGED_EVENT = 'marko:music-library-changed';

export interface MusicLibraryTrack {
  id: string;
  videoId: string;
  title: string;
  channel: string;
  genre: string;
  description?: string;
  isLive?: boolean;
  custom?: boolean;
}

export interface MusicLibrary {
  userTracks: MusicLibraryTrack[];
  hiddenIds: string[];
}

async function readLibraryRaw(): Promise<MusicLibrary> {
  try {
    const raw = await window.marko.musicLibraryRead();
    if (!raw) return { userTracks: [], hiddenIds: [] };
    const parsed = JSON.parse(raw) as Partial<MusicLibrary>;
    return {
      userTracks: Array.isArray(parsed.userTracks) ? parsed.userTracks : [],
      hiddenIds: Array.isArray(parsed.hiddenIds) ? parsed.hiddenIds : [],
    };
  } catch {
    return { userTracks: [], hiddenIds: [] };
  }
}

async function writeLibrary(lib: MusicLibrary): Promise<void> {
  await window.marko.musicLibraryWrite(JSON.stringify(lib));
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

/** Add a YouTube track to the user library. De-dupes by videoId.
 *  Returns the new userTracks array. */
export async function saveTrackToLibrary(input: {
  videoId: string;
  title: string;
  channel: string;
  genre: string;
  isLive?: boolean;
}): Promise<MusicLibraryTrack[]> {
  const lib = await readLibraryRaw();
  if (lib.userTracks.some((t) => t.videoId === input.videoId)) {
    return lib.userTracks;
  }
  const track: MusicLibraryTrack = {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    videoId: input.videoId,
    title: input.title.trim() || 'Untitled',
    channel: input.channel.trim() || 'Unknown',
    genre: input.genre || 'Other',
    isLive: input.isLive || undefined,
    custom: true,
  };
  const next = { ...lib, userTracks: [...lib.userTracks, track] };
  await writeLibrary(next);
  return next.userTracks;
}

/** Subscribe to library mutations from elsewhere in the app. */
export function subscribeMusicLibrary(fn: () => void): () => void {
  const handler = () => fn();
  window.addEventListener(CHANGED_EVENT, handler);
  return () => window.removeEventListener(CHANGED_EVENT, handler);
}

/** Pull a YouTube video id out of any of the common URL forms (or an
 *  already-bare 11-char id). Returns null when the input is unrecognized. */
export function parseVideoId(input: string): string | null {
  const trim = input.trim();
  if (!trim) return null;
  if (/^[\w-]{11}$/.test(trim)) return trim;
  try {
    const u = new URL(trim);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:embed|live|shorts)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

/** Best-effort genre guesser — runs against a lowercased blob of
 *  title + description. Order matters: more specific terms first
 *  (e.g. "lofi hip hop" matches Lofi rather than Hip Hop). */
export function detectGenre(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(lofi|lo-fi|lo fi)\b/.test(t)) return 'Lofi';
  if (/\bsynthwave|synth wave|vaporwave|outrun\b/.test(t)) return 'Synthwave';
  if (/\bjazz\s*hop|jazzhop\b/.test(t)) return 'Jazz Hop';
  if (/\bjazz|bossa nova\b/.test(t)) return 'Jazz';
  if (/\bclassic(al)?\b/.test(t) || /\b(piano|baroque|symphony|orchestra)\b/.test(t)) return 'Classical';
  if (/\bcinematic|soundtrack|score\b/.test(t)) return 'Cinematic';
  if (/\bambient|drone|atmospheric\b/.test(t)) return 'Ambient';
  if (/\bdrum.?n.?bass|drum and bass|dnb\b/.test(t)) return 'Drum & Bass';
  if (/\b(edm|techno|house|trance|electronic|electro)\b/.test(t)) return 'Electronic';
  if (/\bhip.?hop|rap\b/.test(t)) return 'Hip Hop';
  if (/\br&b|rnb|rhythm and blues\b/.test(t)) return 'R&B';
  if (/\bsoul\b/.test(t)) return 'Soul';
  if (/\bfunk\b/.test(t)) return 'Funk';
  if (/\bcountry|americana\b/.test(t)) return 'Country';
  if (/\b(rock|metal|punk)\b/.test(t)) return 'Rock';
  if (/\bindie\b/.test(t)) return 'Indie';
  if (/\bfolk|acoustic\b/.test(t)) return 'Folk';
  if (/\bk[\s\-_]?pop|korean pop\b/.test(t)) return 'K-pop';
  if (/\bj[\s\-_]?pop|japanese pop\b/.test(t)) return 'J-pop';
  if (/\bc[\s\-_]?pop|mandopop|cantopop|chinese pop\b/.test(t)) return 'C-pop';
  if (/\bpop\b/.test(t)) return 'Pop';
  if (/\b(focus|brain|concentration|study|deep work|binaural)\b/.test(t)) return 'Focus / Brain';
  return null;
}
