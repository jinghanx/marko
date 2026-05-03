import { useEffect, useMemo, useRef, useState } from 'react';
import { workspace } from '../state/workspace';


/** Spotify-style focus-music tab. Curated YouTube videos & live streams
 *  good for working — lofi, jazz, synthwave, ambient — plus a way to
 *  paste in your own links so you don't have to keep tabbing over to
 *  YouTube. The actual audio is served by an offscreen <iframe> running
 *  the YouTube IFrame API; the visible UI is purely our own controls. */

interface Track {
  /** Stable per-tab id; not the YouTube id. */
  id: string;
  videoId: string;
  title: string;
  channel: string;
  genre: string;
  description?: string;
  /** True for 24/7 live streams (Lofi Girl etc.). Drives the LIVE badge
   *  and the player-bar pulse. */
  isLive?: boolean;
  /** User-added tracks can be removed; curated ones can't. */
  custom?: boolean;
}

/** Curated set — well-known, long-running focus-music streams. The
 *  Lofi Girl streams in particular have been live for years and are the
 *  most stable picks. The user expands the library with the Add button
 *  for anything else they want quick access to. */
const CURATED: Track[] = [
  {
    id: 'lofigirl-beats',
    videoId: 'jfKfPfyJRdk',
    title: 'lofi hip hop radio — beats to relax/study to',
    channel: 'Lofi Girl',
    genre: 'Lofi',
    description:
      'The classic 24/7 lofi study stream. Slow ~70 BPM beats, no lyrics — sits in the focus sweet spot.',
    isLive: true,
  },
  {
    id: 'lofigirl-synthwave',
    videoId: '4xDzrJKXOOY',
    title: 'synthwave radio — beats to chill/drive to',
    channel: 'Lofi Girl',
    genre: 'Synthwave',
    description:
      'Retro-futuristic neon synthwave — slightly more energetic than lofi, great for late-night deep work.',
    isLive: true,
  },
  {
    id: 'lofigirl-sleepy',
    videoId: 'rUxyKA_-grg',
    title: 'sleepy lofi — beats to fall asleep/chill to',
    channel: 'Lofi Girl',
    genre: 'Lofi',
    description:
      'The slowest of the Lofi Girl streams — minimal beats, ideal for deep concentration or unwinding.',
    isLive: true,
  },
  {
    id: 'chillhop-cafe',
    videoId: '5yx6BWlEVcY',
    title: 'lofi hip hop radio — chill beats',
    channel: 'Chillhop Music',
    genre: 'Lofi',
    description: 'Chillhop’s long-running radio — broader genre mix than Lofi Girl.',
    isLive: true,
  },
  {
    id: 'jazzhop-cafe',
    videoId: '28KRPhVzCus',
    title: 'jazz hop café — relaxing jazz hop radio',
    channel: 'The Jazz Hop Café',
    genre: 'Jazz Hop',
    description: 'Jazz-leaning lofi for reading sessions and slow-thinking work.',
    isLive: true,
  },
];

/** Genres in the Add Link dropdown. Sorted roughly by frequency for
 *  focus-music streams; "Other" is the catch-all. The Live flag is
 *  separate (a checkbox), so genres don't have a "Live · " variant. */
const MUSIC_GENRES = [
  'Lofi',
  'Synthwave',
  'Jazz',
  'Jazz Hop',
  'Ambient',
  'Cinematic',
  'Classical',
  'Electronic',
  'Hip Hop',
  'R&B',
  'Soul',
  'Funk',
  'Country',
  'Rock',
  'Indie',
  'Folk',
  'Pop',
  'K-pop',
  'C-pop',
  'J-pop',
  'Drum & Bass',
  'Focus / Brain',
  'Other',
];

/** Best-effort genre guesser — runs against the lowercased title +
 *  description (incl. hashtags) of a freshly-added video. Order
 *  matters: more specific terms first so e.g. "lofi hip hop" matches
 *  Lofi rather than Hip Hop. Returns null if nothing matches; the
 *  caller falls back to whatever the user picked in the dropdown. */
function detectGenre(text: string): string | null {
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
  // Asian-pop matches must come before plain `pop` so "kpop", "k-pop",
  // "j-pop", "c-pop", or "mandopop" / "cantopop" don't get captured by
  // the generic Pop branch.
  if (/\bk[\s\-_]?pop|korean pop\b/.test(t)) return 'K-pop';
  if (/\bj[\s\-_]?pop|japanese pop\b/.test(t)) return 'J-pop';
  if (/\bc[\s\-_]?pop|mandopop|cantopop|chinese pop\b/.test(t)) return 'C-pop';
  if (/\bpop\b/.test(t)) return 'Pop';
  if (/\b(focus|brain|concentration|study|deep work|binaural)\b/.test(t)) return 'Focus / Brain';
  return null;
}

interface Persisted {
  currentTrackId?: string | null;
  volume?: number;
}

function readPersisted(content: string): Persisted {
  try {
    return content ? (JSON.parse(content) as Persisted) : {};
  } catch {
    return {};
  }
}

/** Library state — user-added tracks plus IDs of curated tracks the
 *  user has hidden. Stored in localStorage at this key (not in the
 *  music tab's content) so it survives closing and re-opening the
 *  tab and any restart of the app. */
const LIBRARY_KEY = 'marko:music:library';
interface MusicLibrary {
  userTracks: Track[];
  hiddenIds: string[];
}
function loadLibrary(): MusicLibrary {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return { userTracks: [], hiddenIds: [] };
    const parsed = JSON.parse(raw) as Partial<MusicLibrary>;
    const rawTracks = Array.isArray(parsed.userTracks) ? parsed.userTracks : [];
    // Migrate the old `category` field → new `genre`. Old entries also
    // had "Live · Lofi" style values; strip the prefix and set isLive.
    const userTracks = rawTracks.map((t) => {
      const legacy = t as unknown as { category?: string };
      let genre = t.genre ?? legacy.category ?? 'Other';
      let isLive = !!t.isLive;
      if (genre.startsWith('Live · ')) {
        isLive = true;
        genre = genre.slice('Live · '.length);
      }
      return { ...t, genre, isLive };
    });
    return {
      userTracks,
      hiddenIds: Array.isArray(parsed.hiddenIds) ? parsed.hiddenIds : [],
    };
  } catch {
    return { userTracks: [], hiddenIds: [] };
  }
}
function saveLibrary(lib: MusicLibrary) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
  } catch {
    /* quota / private mode — best effort */
  }
}

function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Pull a YouTube video id out of any of the common URL forms (or an
 *  already-bare 11-char id). Returns null when the input is unrecognized. */
function parseVideoId(input: string): string | null {
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

interface Props {
  tabId: string;
  initialValue: string;
}

export function MusicView({ tabId, initialValue }: Props) {
  const initial = useMemo(() => readPersisted(initialValue), [initialValue]);
  // Library lives in localStorage so it survives tab close/reopen and
  // app restart. Tab.content only carries per-tab state (current
  // track + volume).
  const initialLibrary = useMemo(() => loadLibrary(), []);
  const [userTracks, setUserTracks] = useState<Track[]>(initialLibrary.userTracks);
  const [hiddenIds, setHiddenIds] = useState<string[]>(initialLibrary.hiddenIds);
  const [showHidden, setShowHidden] = useState(false);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(
    initial.currentTrackId ?? null,
  );
  const [volume, setVolume] = useState(initial.volume ?? 60);
  const [playing, setPlaying] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Web Audio anchor for macOS Now Playing. Chromium only surfaces a
  // page's MediaSession to the OS when there's an active audio stream
  // owned by that page — the YouTube iframe's audio is in a different
  // frame and its session competes with ours. A silent oscillator in
  // our renderer's audio graph is what tells macOS "this app is
  // producing audio", which makes our MediaSession metadata show up
  // in the top-right Now Playing widget.
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Mirror `playing` into a ref so click handlers never read a stale
  // closure value (rapid toggle taps would otherwise duplicate the
  // same command instead of flipping). Updated in a useEffect below.
  const playingRef = useRef(false);
  const allTracks = useMemo(() => [...CURATED, ...userTracks], [userTracks]);
  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  // `tracks` is the visible library — what playTrack / skipTrack walk
  // and what the cards render. Hidden curated picks live in
  // `hiddenTracks` and only show when the user opens the manage view.
  const tracks = useMemo(
    () => allTracks.filter((t) => !hiddenSet.has(t.id)),
    [allTracks, hiddenSet],
  );
  const hiddenTracks = useMemo(
    () => allTracks.filter((t) => hiddenSet.has(t.id)),
    [allTracks, hiddenSet],
  );
  const currentTrack = useMemo(
    () => allTracks.find((t) => t.id === currentTrackId) ?? null,
    [allTracks, currentTrackId],
  );

  // Persist current track + volume into tab.content (per-tab state).
  // Use `rebaseSavedContent` (not `updateContent`) so the tab never
  // looks dirty — music tab state is always saved instantly, there's
  // no editor concept of "unsaved changes" to confirm on close.
  useEffect(() => {
    const data: Persisted = { currentTrackId, volume };
    workspace.rebaseSavedContent(tabId, JSON.stringify(data));
  }, [tabId, currentTrackId, volume]);

  // Persist the library to localStorage on every change. Survives tab
  // close, reopen, and app restart.
  useEffect(() => {
    saveLibrary({ userTracks, hiddenIds });
  }, [userTracks, hiddenIds]);

  // Reflect the playing track in the tab title — the now-playing pill
  // in the titlebar reads this directly.
  useEffect(() => {
    const title = currentTrack ? `Music · ${currentTrack.channel}` : 'Music';
    workspace.setState((prev) => ({
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
    }));
  }, [tabId, currentTrack]);

  /** Send a YouTube IFrame API command to our embedded iframe. */
  const sendCommand = (func: string, args: unknown[] = []) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      'https://www.youtube.com',
    );
  };
  const ytPlay = () => sendCommand('playVideo');
  const ytPause = () => sendCommand('pauseVideo');

  // Volume — forwarded to YouTube via IFrame API.
  useEffect(() => {
    sendCommand('setVolume', [volume]);
  }, [volume]);

  // Subscribe to YouTube state-change events as soon as the iframe loads.
  const onIframeLoad = () => {
    sendCommand('addEventListener', ['onStateChange']);
    sendCommand('setVolume', [volume]);
  };

  // Listen for state events from the YouTube iframe.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.origin !== 'string' || !e.origin.includes('youtube.com')) return;
      if (typeof e.data !== 'string') return;
      try {
        const data = JSON.parse(e.data);
        if (data?.event !== 'onStateChange') return;
        // YT.PlayerState — 1 PLAYING, 2 PAUSED, 0 ENDED, 3 BUFFERING, 5 CUED
        if (data.info === 1) {
          setPlaying(true);
          workspace.setTabPlaying(tabId, true);
        } else if (data.info === 2 || data.info === 0) {
          setPlaying(false);
          workspace.setTabPlaying(tabId, false);
        }
      } catch {
        /* not a JSON message we care about */
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      workspace.setTabPlaying(tabId, false);
    };
  }, [tabId]);

  /** Lazy-create the silent-tone audio context. Called from inside a
   *  user gesture (the play-button click) so the context starts in
   *  the "running" state on first track selection. */
  const ensureAudioAnchor = (): AudioContext | null => {
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.frequency.value = 220;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      audioCtxRef.current = ctx;
      return ctx;
    } catch {
      return null;
    }
  };

  // Resume / suspend the silent tone in lockstep with the playing
  // state we get from the iframe. macOS Now Playing watches the
  // `running` state of our audio graph to decide whether to show the
  // widget for our app.
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (currentTrack && playing) {
      void ctx.resume();
    } else {
      void ctx.suspend();
    }
  }, [currentTrack, playing]);

  // Tear down the audio context on unmount so it doesn't keep the
  // audio device open after the user closes the music tab.
  useEffect(() => {
    return () => {
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      if (ctx && ctx.state !== 'closed') void ctx.close();
    };
  }, []);

  // Set MediaSession in our renderer. Combined with the Web Audio
  // silent-tone anchor above, macOS Now Playing should display our
  // metadata. We re-apply on a short delay too because YouTube's
  // iframe sets its own MediaSession when it starts playing — last
  // writer wins, so we want ours to land after theirs.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const apply = () => {
      if (!currentTrack) {
        ms.metadata = null;
        ms.playbackState = 'none';
        try {
          ms.setActionHandler('play', null);
          ms.setActionHandler('pause', null);
          ms.setActionHandler('previoustrack', null);
          ms.setActionHandler('nexttrack', null);
        } catch {
          /* unsupported */
        }
        return;
      }
      ms.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.channel,
        album: currentTrack.genre,
        artwork: [
          { src: thumbnailUrl(currentTrack.videoId), sizes: '480x360', type: 'image/jpeg' },
        ],
      });
      ms.playbackState = playing ? 'playing' : 'paused';
      try {
        ms.setActionHandler('play', ytPlay);
        ms.setActionHandler('pause', ytPause);
        ms.setActionHandler('previoustrack', () => skipTrack(-1));
        ms.setActionHandler('nexttrack', () => skipTrack(1));
      } catch {
        /* unsupported */
      }
    };
    apply();
    // YouTube's iframe sets its own MediaSession asynchronously after
    // the video starts. Re-apply at a few intervals so ours is the
    // most recent (and thus the one macOS surfaces).
    const t1 = setTimeout(apply, 250);
    const t2 = setTimeout(apply, 1000);
    const t3 = setTimeout(apply, 2500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [currentTrack, playing, tracks.length]);

  // Keep playingRef in sync with state. Click handlers below read
  // from the ref to avoid stale-closure bugs when the user taps
  // play/pause rapidly.
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const playTrack = (track: Track) => {
    // Lazy-init the silent-tone audio anchor on the first user click —
    // AudioContext starts in `running` state when created from a
    // gesture, which is what macOS Now Playing needs to surface our
    // MediaSession.
    ensureAudioAnchor();
    if (track.id === currentTrackId) {
      // Toggle on the active track. Optimistic state flip so the UI
      // never lags the click; the iframe's state-change message will
      // correct any divergence afterwards.
      const next = !playingRef.current;
      if (next) ytPlay();
      else ytPause();
      setPlaying(next);
      playingRef.current = next;
      // Update the workspace's playing-tab set directly. The iframe's
      // state-change event would do this too, but we don't trust it
      // to always arrive (YouTube IFrame API has handshake quirks
      // inside Electron) — and the titlebar Now Playing pill reads
      // straight from this flag.
      workspace.setTabPlaying(tabId, next);
      return;
    }
    setCurrentTrackId(track.id);
    setPlaying(true);
    playingRef.current = true;
    workspace.setTabPlaying(tabId, true);
  };

  const togglePlay = () => {
    if (!currentTrack) return;
    ensureAudioAnchor();
    const next = !playingRef.current;
    if (next) ytPlay();
    else ytPause();
    setPlaying(next);
    playingRef.current = next;
    workspace.setTabPlaying(tabId, next);
  };

  /** Move to the next or previous track in the visible library order.
   *  Used by the macOS Now Playing prev/next buttons. */
  const skipTrack = (delta: 1 | -1) => {
    if (tracks.length === 0) return;
    const idx = tracks.findIndex((t) => t.id === currentTrackId);
    const nextIdx = ((idx < 0 ? 0 : idx) + delta + tracks.length) % tracks.length;
    const next = tracks[nextIdx];
    setCurrentTrackId(next.id);
    setPlaying(true);
    playingRef.current = true;
  };


  const addCustomTrack = (
    videoId: string,
    title: string,
    channel: string,
    genre: string,
    isLive: boolean,
  ): string | null => {
    if (!videoId) return 'Could not find a YouTube video id in that URL';
    if (allTracks.some((t) => t.videoId === videoId)) {
      return 'That track is already in your library';
    }
    const track: Track = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      videoId,
      title: title.trim() || 'Untitled',
      channel: channel.trim() || 'Unknown',
      genre: genre || 'Other',
      isLive: isLive || undefined,
      custom: true,
    };
    setUserTracks((prev) => [...prev, track]);
    return null;
  };

  /** Remove a track from the visible library. User-added tracks are
   *  spliced out entirely; curated tracks are added to `hiddenIds` so
   *  they can be restored later (and survive a code update that adds
   *  new curated picks). */
  const removeTrack = (id: string) => {
    const track = allTracks.find((t) => t.id === id);
    if (!track) return;
    if (track.custom) {
      setUserTracks((prev) => prev.filter((t) => t.id !== id));
    } else {
      setHiddenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    }
    if (currentTrackId === id) {
      setCurrentTrackId(null);
      setPlaying(false);
      workspace.setTabPlaying(tabId, false);
    }
  };

  const restoreTrack = (id: string) => {
    setHiddenIds((prev) => prev.filter((h) => h !== id));
  };

  // Group by genre for section headings, preserving the order tracks
  // were declared in (curated first, then user-added).
  const grouped = useMemo(() => {
    const map = new Map<string, Track[]>();
    for (const t of tracks) {
      const arr = map.get(t.genre) ?? [];
      arr.push(t);
      map.set(t.genre, arr);
    }
    return [...map.entries()];
  }, [tracks]);

  return (
    <div className="music">
      <div className="music-header">
        <div>
          <h1 className="music-title">Focus Music</h1>
          <div className="music-subtitle">
            Curated streams + whatever you save — no more tabbing back to YouTube.
          </div>
        </div>
        <button className="music-add" onClick={() => setAddOpen(true)}>
          <span aria-hidden>＋</span> Add link
        </button>
      </div>

      <div className="music-scroll">
        {grouped.map(([genre, items]) => (
          <section key={genre} className="music-section">
            <h2 className="music-section-title">{genre}</h2>
            <div className="music-grid">
              {items.map((track) => (
                <TrackCard
                  key={track.id}
                  track={track}
                  isCurrent={currentTrackId === track.id}
                  isPlaying={currentTrackId === track.id && playing}
                  onPlay={() => playTrack(track)}
                  onRemove={() => removeTrack(track.id)}
                  removeLabel={track.custom ? 'Remove from library' : 'Hide from library'}
                />
              ))}
            </div>
          </section>
        ))}

        {userTracks.length === 0 && (
          <div className="music-hint">
            Tip — paste any YouTube URL with the <kbd>+ Add link</kbd> button to keep your own picks
            here. Bare video ids and live URLs work too.
          </div>
        )}

        {hiddenTracks.length > 0 && (
          <section className="music-section music-section--hidden">
            <button
              className="music-hidden-toggle"
              onClick={() => setShowHidden((v) => !v)}
            >
              {showHidden ? '▾' : '▸'} Hidden ({hiddenTracks.length})
              <span className="music-hidden-hint">
                {showHidden
                  ? 'click a Restore button to bring one back'
                  : 'tracks you removed — click to manage'}
              </span>
            </button>
            {showHidden && (
              <div className="music-hidden-list">
                {hiddenTracks.map((track) => (
                  <div key={track.id} className="music-hidden-row">
                    <img
                      className="music-hidden-art"
                      src={thumbnailUrl(track.videoId)}
                      alt=""
                      loading="lazy"
                    />
                    <div className="music-hidden-info">
                      <div className="music-hidden-title">{track.title}</div>
                      <div className="music-hidden-meta">
                        {track.channel} · {track.genre}
                      </div>
                    </div>
                    <button
                      className="music-hidden-restore"
                      onClick={() => restoreTrack(track.id)}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <div className="music-player">
        <div className="music-player-track">
          {/* Live YouTube embed in the player-bar art slot. Regular
            * <iframe> (not an Electron <webview>) because YouTube
            * blocks embeds loaded as a top-level navigation. Audio
            * comes from this iframe; the silent-audio anchor below
            * is what tells macOS Now Playing to use OUR
            * MediaSession.metadata. */}
          <div className="music-player-art-wrap">
            {currentTrack ? (
              <iframe
                ref={iframeRef}
                key={currentTrack.videoId}
                className="music-player-art music-player-art--live"
                src={`https://www.youtube.com/embed/${currentTrack.videoId}?autoplay=1&enablejsapi=1&modestbranding=1&rel=0&playsinline=1`}
                allow="autoplay; encrypted-media"
                title="Music player"
                onLoad={onIframeLoad}
              />
            ) : (
              <div className="music-player-art music-player-art--empty" aria-hidden />
            )}
          </div>
          {currentTrack ? (
            <div className="music-player-info">
              <div className="music-player-title" title={currentTrack.title}>
                {currentTrack.title}
              </div>
              <div className="music-player-channel">
                <span>{currentTrack.channel}</span>
                {currentTrack.isLive && <span className="music-live music-live--mini">● LIVE</span>}
              </div>
            </div>
          ) : (
            <div className="music-player-empty">Pick something from above to start</div>
          )}
        </div>

        <div className="music-player-controls">
          <button
            className="music-play-btn"
            onClick={togglePlay}
            disabled={!currentTrack}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <PauseGlyph /> : <PlayGlyph />}
          </button>
        </div>

        <div className="music-player-volume">
          <SpeakerGlyph muted={volume === 0} />
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Volume"
            // Drives the filled portion of the slider track via the
            // CSS gradient on .music-player-volume input.
            style={{ '--vol-pct': `${volume}%` } as React.CSSProperties}
          />
          <span className="music-player-volume-readout">{volume}</span>
        </div>
      </div>

      {addOpen && (
        <AddTrackModal
          onClose={() => setAddOpen(false)}
          onAdd={(videoId, title, channel, genre, isLive) =>
            addCustomTrack(videoId, title, channel, genre, isLive)
          }
        />
      )}
    </div>
  );
}

function TrackCard({
  track,
  isCurrent,
  isPlaying,
  onPlay,
  onRemove,
  removeLabel,
}: {
  track: Track;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <div className={`music-card${isCurrent ? ' music-card--active' : ''}`}>
      <button className="music-card-art" onClick={onPlay} title={track.description ?? track.title}>
        <img src={thumbnailUrl(track.videoId)} alt="" loading="lazy" />
        <span className="music-card-overlay" aria-hidden>
          {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
        </span>
        {track.isLive && <span className="music-live music-live--card">● LIVE</span>}
      </button>
      <div className="music-card-info">
        <div className="music-card-title">{track.title}</div>
        <div className="music-card-meta">
          <span className="music-card-channel">{track.channel}</span>
          {onRemove && (
            <button
              className="music-card-remove"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              aria-label={removeLabel ?? 'Remove from library'}
              title={removeLabel ?? 'Remove'}
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AddTrackModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  /** Returns an error message on failure, null on success. */
  onAdd: (
    videoId: string,
    title: string,
    channel: string,
    genre: string,
    isLive: boolean,
  ) => string | null;
}) {
  const [url, setUrl] = useState('');
  const [genre, setGenre] = useState<string>('Other');
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<
    | { videoId: string; title: string; channel: string; description: string }
    | null
  >(null);
  const [loading, setLoading] = useState(false);

  // Whenever the URL parses to a valid id, fetch metadata so the
  // user can preview the title and we can guess a genre. Debounced
  // so a flurry of keystrokes doesn't spam main.
  const fetchTokenRef = useRef(0);
  useEffect(() => {
    const videoId = parseVideoId(url);
    if (!videoId) {
      setMeta(null);
      return;
    }
    const token = ++fetchTokenRef.current;
    const t = setTimeout(() => {
      setLoading(true);
      void (async () => {
        const r = await window.marko.youtubeMetadata(videoId);
        if (token !== fetchTokenRef.current) return;
        setLoading(false);
        if (!r.ok) {
          setMeta({ videoId, title: '', channel: '', description: '' });
          return;
        }
        setMeta({
          videoId,
          title: r.title,
          channel: r.channel,
          description: r.description,
        });
        setIsLive(r.isLive);
        // Best-effort genre guess from the title + description (where
        // hashtags usually live). Override only if user hasn't picked
        // anything besides the default.
        const guess = detectGenre(`${r.title}\n${r.description}`);
        if (guess) setGenre(guess);
      })();
    }, 250);
    return () => clearTimeout(t);
  }, [url]);

  const submit = () => {
    if (!meta) {
      setError('Paste a YouTube URL or video id');
      return;
    }
    const err = onAdd(meta.videoId, meta.title, meta.channel, genre, isLive);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="music-add-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add a YouTube link</h3>
        <div className="music-add-fields">
          <input
            autoFocus
            className="music-add-input"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="https://youtube.com/watch?v=… or a bare video id"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              else if (e.key === 'Escape') onClose();
            }}
          />

          {/* Live preview of fetched metadata so the user can see what
            * they're saving before they hit Add. */}
          {loading && <div className="music-add-status">Fetching video info…</div>}
          {meta && !loading && (
            <div className="music-add-preview">
              {meta.title ? (
                <>
                  <div className="music-add-preview-title">{meta.title}</div>
                  <div className="music-add-preview-channel">{meta.channel}</div>
                </>
              ) : (
                <div className="music-add-preview-empty">
                  Couldn't read video info — adding anyway will use the link as-is.
                </div>
              )}
            </div>
          )}

          <label className="music-add-label">
            <span>Genre</span>
            <select
              className="music-add-select"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
              }}
            >
              {MUSIC_GENRES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>

          <label className="music-add-checkbox">
            <input
              type="checkbox"
              checked={isLive}
              onChange={(e) => setIsLive(e.target.checked)}
            />
            <span>Live stream (24/7 broadcast)</span>
          </label>
        </div>
        {error && <div className="music-add-error">{error}</div>}
        <div className="music-add-actions">
          <button className="music-add-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="music-add-submit"
            onClick={submit}
            disabled={!meta || loading}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden>
      {/* Slightly inset and rounded so the triangle reads as a chunky
        * shape inside the bubble rather than a thin geometric icon. */}
      <path
        d="M7.5 5.2 L18.5 11.6 a0.5 0.5 0 0 1 0 0.8 L7.5 18.8 a0.5 0.5 0 0 1 -0.8 -0.4 V5.6 a0.5 0.5 0 0 1 0.8 -0.4 z"
        fill="currentColor"
      />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden>
      <rect x="6.5" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" />
      <rect x="13.5" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function SpeakerGlyph({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden fill="none">
      <path
        d="M5 9 H8 L13 5 V19 L8 15 H5 Z"
        fill="currentColor"
      />
      {!muted && (
        <>
          <path
            d="M16 9 Q18 12 16 15"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M18.5 7 Q21.5 12 18.5 17"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
