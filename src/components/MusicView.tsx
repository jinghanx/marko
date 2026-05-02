import { useEffect, useMemo, useRef, useState } from 'react';
import { workspace } from '../state/workspace';

/** Bare-minimum radio player styled like an analog mixer console. Curated
 *  SomaFM streams (free, public, commercial-free) grouped by vibe. The
 *  audio element drives the same `setTabPlaying` flag MediaViewer uses,
 *  so the titlebar's now-playing pill lights up automatically. */

type Vibe = 'Focus' | 'Chill' | 'Lo-Fi' | 'Energetic' | 'Indie';

interface Station {
  id: string;
  name: string;
  short: string;
  vibe: Vibe;
  description: string;
  url: string;
}

const STATIONS: Station[] = [
  { id: 'groovesalad', name: 'Groove Salad', short: 'GS', vibe: 'Focus', description: 'Chilled ambient & downtempo electronic', url: 'https://ice2.somafm.com/groovesalad-128-mp3' },
  { id: 'dronezone', name: 'Drone Zone', short: 'DZ', vibe: 'Focus', description: 'Atmospheric ambient space music', url: 'https://ice2.somafm.com/dronezone-128-mp3' },
  { id: 'deepspaceone', name: 'Deep Space One', short: 'DS', vibe: 'Focus', description: 'Deep ambient electronic for late-night work', url: 'https://ice2.somafm.com/deepspaceone-128-mp3' },
  { id: 'lush', name: 'Lush', short: 'LU', vibe: 'Chill', description: 'Mellow vocals & downbeat — coffee-shop tier', url: 'https://ice2.somafm.com/lush-128-mp3' },
  { id: 'beatblender', name: 'Beat Blender', short: 'BB', vibe: 'Chill', description: 'Late-night blend of deep, downtempo grooves', url: 'https://ice2.somafm.com/beatblender-128-mp3' },
  { id: 'secretagent', name: 'Secret Agent', short: 'SA', vibe: 'Chill', description: 'Lounge, jazzy, vaguely espionage', url: 'https://ice2.somafm.com/secretagent-128-mp3' },
  { id: 'vaporwaves', name: 'Vaporwaves', short: 'VW', vibe: 'Lo-Fi', description: '80s/90s nostalgia chopped, screwed, drifting', url: 'https://ice2.somafm.com/vaporwaves-128-mp3' },
  { id: 'fluid', name: 'Fluid', short: 'FL', vibe: 'Lo-Fi', description: 'Liquid drum & bass — chilled rhythmic groove', url: 'https://ice2.somafm.com/fluid-128-mp3' },
  { id: 'missioncontrol', name: 'Mission Control', short: 'MC', vibe: 'Lo-Fi', description: 'Ambient + lounge + space-program chatter', url: 'https://ice2.somafm.com/missioncontrol-128-mp3' },
  { id: 'sonicuniverse', name: 'Sonic Universe', short: 'SU', vibe: 'Lo-Fi', description: 'Jazz-leaning electronica & nu-jazz', url: 'https://ice2.somafm.com/sonicuniverse-128-mp3' },
  { id: 'defcon', name: 'DEF CON Radio', short: 'DC', vibe: 'Energetic', description: 'Electronic music for hackers — faster pulse', url: 'https://ice2.somafm.com/defcon-128-mp3' },
  { id: 'cliqhop', name: 'cliqhop idm', short: 'CQ', vibe: 'Energetic', description: 'Glitchy, rhythmic intelligent dance music', url: 'https://ice2.somafm.com/cliqhop-128-mp3' },
  { id: 'thetrip', name: 'The Trip', short: 'TT', vibe: 'Energetic', description: 'Progressive house & trance for the long stretch', url: 'https://ice2.somafm.com/thetrip-128-mp3' },
  { id: 'indiepop', name: 'Indie Pop Rocks', short: 'IP', vibe: 'Indie', description: 'New & classic indie pop with vocals', url: 'https://ice2.somafm.com/indiepop-128-mp3' },
  { id: 'bootliquor', name: 'Boot Liquor', short: 'BL', vibe: 'Indie', description: 'Roots, alt-country, Americana', url: 'https://ice2.somafm.com/bootliquor-128-mp3' },
];

const VIBES: Vibe[] = ['Focus', 'Chill', 'Lo-Fi', 'Energetic', 'Indie'];

interface Persisted {
  vibe?: Vibe;
  stationId?: string | null;
  volume?: number;
}

function readPersisted(content: string): Persisted {
  try {
    return content ? (JSON.parse(content) as Persisted) : {};
  } catch {
    return {};
  }
}

interface Props {
  tabId: string;
  initialValue: string;
}

export function MusicView({ tabId, initialValue }: Props) {
  const initial = useMemo(() => readPersisted(initialValue), [initialValue]);
  const [vibe, setVibe] = useState<Vibe>(initial.vibe ?? 'Focus');
  const [stationId, setStationId] = useState<string | null>(initial.stationId ?? null);
  const [volume, setVolume] = useState<number>(initial.volume ?? 0.8);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stations = useMemo(() => STATIONS.filter((s) => s.vibe === vibe), [vibe]);
  const station = useMemo(
    () => STATIONS.find((s) => s.id === stationId) ?? null,
    [stationId],
  );

  // Persist state into the tab so a restart picks up the same vibe and
  // station — mirrors how HttpClient stashes its body in tab.content.
  useEffect(() => {
    const data: Persisted = { vibe, stationId, volume };
    workspace.updateContent(tabId, JSON.stringify(data));
  }, [tabId, vibe, stationId, volume]);

  // Reflect the active station in the tab title so the now-playing pill
  // and the tab bar both show what's playing without extra fields.
  useEffect(() => {
    const title = station ? `Radio · ${station.name}` : 'Radio';
    workspace.setState((prev) => ({
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
    }));
  }, [tabId, station]);

  // Mirror play/pause to workspace state — the single hook the titlebar's
  // NowPlaying pill watches. Same shape as MediaViewer.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => {
      workspace.setTabPlaying(tabId, true);
      setPlaying(true);
      setLoading(false);
      setError(null);
    };
    const onPause = () => {
      workspace.setTabPlaying(tabId, false);
      setPlaying(false);
    };
    const onWaiting = () => setLoading(true);
    const onPlaying = () => setLoading(false);
    const onError = () => {
      setError('Stream unavailable. Pick another station.');
      setLoading(false);
      setPlaying(false);
      workspace.setTabPlaying(tabId, false);
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onPause);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onPause);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('error', onError);
      workspace.setTabPlaying(tabId, false);
    };
  }, [tabId, station?.url]);

  // No Web Audio AnalyserNode here — once you call
  // createMediaElementSource the element's audio is rerouted through the
  // graph, and Chromium's autoplay policy creates the context suspended.
  // That fight isn't worth it for visualization data that the
  // cross-origin SomaFM streams would block anyway. The spectrum and VU
  // run on a synthetic-while-playing signal — convincing enough, and
  // the speakers always work.

  // Volume slider drives the audio element directly.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const pickStation = (id: string) => {
    setStationId(id);
    setError(null);
    setLoading(true);
    requestAnimationFrame(() => {
      audioRef.current?.play().catch(() => {
        setLoading(false);
      });
    });
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el || !station) return;
    if (playing) {
      el.pause();
    } else {
      setLoading(true);
      el.play().catch(() => {
        setLoading(false);
        setError('Could not start the stream.');
      });
    }
  };

  const status: 'on-air' | 'cueing' | 'paused' | 'idle' = !station
    ? 'idle'
    : loading
      ? 'cueing'
      : playing
        ? 'on-air'
        : 'paused';

  return (
    <div className="mixer">
      {/* TOP RAIL — vibe selector, looks like an input-source row on a
          studio mixer. Each pill carries an LED that lights when active. */}
      <div className="mixer-rail">
        <div className="mixer-rail-label">SOURCE</div>
        <div className="mixer-vibes">
          {VIBES.map((v) => (
            <button
              key={v}
              className={`mixer-vibe${vibe === v ? ' mixer-vibe--active' : ''}`}
              onClick={() => setVibe(v)}
            >
              <span className="mixer-led" />
              <span className="mixer-vibe-label">{v}</span>
            </button>
          ))}
        </div>
      </div>

      {/* BAY — channel strips, one per station in the active vibe.
          Each strip mimics a hardware channel: top LED, vertical
          accent column, station name + abbreviation. */}
      <div className="mixer-bay">
        {stations.map((s) => {
          const active = stationId === s.id;
          const live = active && playing;
          return (
            <button
              key={s.id}
              className={`mixer-strip${active ? ' mixer-strip--active' : ''}${live ? ' mixer-strip--live' : ''}`}
              onClick={() => pickStation(s.id)}
              title={s.description}
            >
              <span className="mixer-strip-led" />
              <span className="mixer-strip-num">{s.short}</span>
              <span className="mixer-strip-bars" aria-hidden>
                <span /><span /><span /><span /><span /><span /><span /><span />
              </span>
              <span className="mixer-strip-name">{s.name}</span>
              <span className="mixer-strip-vibe">{s.vibe}</span>
            </button>
          );
        })}
      </div>

      {/* SPECTRUM — wide visualizer panel. Fills the otherwise-empty
          middle of the console with a hardware-style frequency display,
          fed by the same AnalyserNode the VU meters use. Falls back to
          a synthetic hump curve when the cross-origin stream blocks
          analysis so it looks alive whenever audio is playing. */}
      <div className="mixer-spectrum">
        <div className="mixer-spectrum-frame">
          <Spectrum playing={playing} />
          <div className="mixer-spectrum-grid" aria-hidden />
          <div className="mixer-spectrum-label">SPECTRUM · 20 Hz — 20 kHz</div>
        </div>
      </div>

      {/* MASTER — bottom rail. LCD readout, transport button, VU meter,
          vertical volume fader. The classic mixer master section. */}
      <div className="mixer-master">
        <div className="mixer-lcd">
          <div className={`mixer-lcd-status mixer-lcd-status--${status}`}>
            <span className="mixer-led" />
            <span>
              {status === 'on-air' && 'ON AIR'}
              {status === 'cueing' && 'CUEING'}
              {status === 'paused' && 'PAUSED'}
              {status === 'idle' && '— STANDBY —'}
            </span>
          </div>
          <div className="mixer-lcd-station">
            {station ? station.name.toUpperCase() : 'SELECT A CHANNEL'}
          </div>
          <div className="mixer-lcd-meta">
            {station ? `${station.vibe.toUpperCase()} · 128 KBPS · MP3` : 'NO SIGNAL'}
          </div>
        </div>

        <button
          className={`mixer-transport${playing ? ' mixer-transport--on' : ''}`}
          onClick={togglePlay}
          disabled={!station}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <span className="mixer-transport-ring" />
          {loading ? <SpinnerGlyph /> : playing ? <PauseGlyph /> : <PlayGlyph />}
        </button>

        <div className="mixer-meters">
          <div className="mixer-meter-label">VU</div>
          <div className="mixer-meter-pair">
            <VuMeter channel="L" playing={playing} />
            <VuMeter channel="R" playing={playing} />
          </div>
          <div className="mixer-meter-scale">
            <span>0</span>
            <span>−6</span>
            <span>−12</span>
            <span>−24</span>
            <span>∞</span>
          </div>
        </div>

        <div className="mixer-fader">
          <div className="mixer-fader-label">MASTER</div>
          <div className="mixer-fader-track">
            <input
              className="mixer-fader-input"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Master volume"
            />
          </div>
          <div className="mixer-fader-readout">{Math.round(volume * 100)}</div>
        </div>
      </div>

      {error && <div className="mixer-error">{error}</div>}

      {/* No crossOrigin attribute: SomaFM streams don't reliably ship CORS
          headers, and setting `anonymous` would refuse to play. Without
          it the analyser returns silent frequency data — the visualizer
          and VU both fall back to a synthetic animation while playing. */}
      <audio ref={audioRef} src={station?.url} preload="none" style={{ display: 'none' }} />

      <div className="mixer-credit">
        SOMA FM · LISTENER-SUPPORTED · COMMERCIAL-FREE ·{' '}
        <a href="https://somafm.com" target="_blank" rel="noopener noreferrer">
          DONATE
        </a>
      </div>
    </div>
  );
}

/** Wide spectrum visualizer — bar-graph EQ that fills the panel's middle.
 *  Synthesizes a breathing bell-curve while playing; flatlines when
 *  paused. Doesn't tap the audio graph because doing so requires
 *  rerouting the element through Web Audio, which fights the autoplay
 *  policy and breaks playback for cross-origin streams. */
function Spectrum({ playing }: { playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelsRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const BARS = 56;
    if (levelsRef.current.length !== BARS) {
      levelsRef.current = new Array(BARS).fill(0);
    }
    let raf = 0;

    const tick = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);

      const targets = new Array(BARS).fill(0);
      if (playing) {
        // Bell curve modulated by two out-of-phase sine waves + a touch
        // of noise. Reads convincingly as live audio without ever
        // touching the actual signal.
        const t = Date.now() / 600;
        for (let i = 0; i < BARS; i++) {
          const x = i / (BARS - 1);
          const bell = Math.exp(-Math.pow((x - 0.35) * 2.6, 2));
          const wobble = 0.5 + 0.5 * Math.sin(t + i * 0.4);
          const wobble2 = 0.5 + 0.5 * Math.sin(t * 1.7 + i * 0.18);
          targets[i] = bell * (0.55 + 0.35 * wobble * wobble2)
            + (Math.random() - 0.5) * 0.05;
          if (targets[i] < 0) targets[i] = 0;
        }
      }
      // Asymmetric easing — rise fast, fall slow — gives bars decay tail.
      const lvls = levelsRef.current;
      for (let i = 0; i < BARS; i++) {
        const cur = lvls[i];
        const tgt = targets[i];
        lvls[i] = tgt > cur ? cur + (tgt - cur) * 0.5 : cur + (tgt - cur) * 0.10;
      }

      const gap = 2 * dpr;
      const barW = (w - gap * (BARS - 1)) / BARS;
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, '#1f8f4d');
      grad.addColorStop(0.55, '#2dd96f');
      grad.addColorStop(0.82, '#f3b41f');
      grad.addColorStop(1, '#ff4d4d');

      for (let i = 0; i < BARS; i++) {
        const v = lvls[i];
        const barH = Math.max(1.5 * dpr, v * h * 0.95);
        const x = i * (barW + gap);
        const y = h - barH;
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, barH);
        ctx.fillStyle = 'rgba(45,217,111,0.07)';
        ctx.fillRect(x, h - 1.5 * dpr, barW, 1.5 * dpr);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return <canvas ref={canvasRef} className="mixer-spectrum-canvas" />;
}

/** Stereo VU meter — vertical LED ladder driven by a phase-offset
 *  synthetic level so each channel breathes differently. Same reason as
 *  Spectrum for not tapping real audio: the Web Audio graph fight isn't
 *  worth a guaranteed silence regression. */
function VuMeter({ channel, playing }: { channel: 'L' | 'R'; playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelRef = useRef(0);
  const phaseSeed = channel === 'L' ? 0 : 0.7;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const SEGMENTS = 14;
    let raf = 0;

    const tick = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);

      let target = 0;
      if (playing) {
        const t = Date.now() / 380 + phaseSeed;
        target = 0.45 + 0.25 * Math.sin(t) + 0.18 * Math.sin(t * 2.3 + 1.1);
        target += (Math.random() - 0.5) * 0.06;
        target = Math.max(0, Math.min(1, target));
      }
      const cur = levelRef.current;
      levelRef.current = target > cur ? cur + (target - cur) * 0.55 : cur + (target - cur) * 0.12;

      const segH = h / SEGMENTS;
      const lit = Math.round(levelRef.current * SEGMENTS);
      for (let i = 0; i < SEGMENTS; i++) {
        const y = h - (i + 1) * segH;
        const fromTop = SEGMENTS - i;
        const isLit = i < lit;
        let color: string;
        if (fromTop <= 2) color = isLit ? '#ff4d4d' : '#3a1818';
        else if (fromTop <= 5) color = isLit ? '#f3b41f' : '#3a2e10';
        else color = isLit ? '#2dd96f' : '#0f2a1b';
        ctx.fillStyle = color;
        ctx.fillRect(2 * dpr, y + 1 * dpr, w - 4 * dpr, segH - 2 * dpr);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, phaseSeed]);

  return (
    <div className="mixer-meter-col">
      <canvas ref={canvasRef} className="mixer-meter-canvas" />
      <div className="mixer-meter-channel">{channel}</div>
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden>
      <path d="M8 5 L19 12 L8 19 Z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden>
      <rect x="7" y="5" width="3.5" height="14" rx="0.6" fill="currentColor" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="0.6" fill="currentColor" />
    </svg>
  );
}

function SpinnerGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden className="mixer-spinner">
      <circle
        cx="12"
        cy="12"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="36 18"
        strokeLinecap="round"
      />
    </svg>
  );
}
