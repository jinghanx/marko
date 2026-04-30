import { useMemo } from 'react';
import { useWorkspace, workspace } from '../state/workspace';

/** Compact "now playing" indicator for the titlebar. Shows a small button per
 *  tab that's currently playing audio/video; clicking jumps to that tab
 *  (switching sessions if needed). Hidden when nothing is playing. */
export function NowPlaying() {
  // useWorkspace selectors must return stable references — building a new
  // array inside the selector triggers the "getSnapshot should be cached"
  // infinite re-render. Read raw state here, derive in useMemo.
  const playingIds = useWorkspace((s) => s.playingTabIds);
  const tabs = useWorkspace((s) => s.tabs);
  const playing = useMemo(() => {
    const out = [];
    for (const id of playingIds) {
      const tab = tabs.find((t) => t.id === id);
      if (tab) out.push(tab);
    }
    return out;
  }, [playingIds, tabs]);

  if (playing.length === 0) return null;
  return (
    <div className="now-playing">
      {playing.map((tab) => (
        <button
          key={tab.id}
          className="now-playing-pill"
          onClick={() => workspace.revealTab(tab.id)}
          title={`Jump to: ${tab.title}`}
        >
          <SoundWaveGlyph />
          <span className="now-playing-label">{tab.title}</span>
        </button>
      ))}
    </div>
  );
}

function SoundWaveGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={12}
      height={12}
      aria-hidden
      className="now-playing-bars"
    >
      <rect x="2.5" y="6" width="2" height="4" rx="0.6" className="np-bar np-bar--1" />
      <rect x="7" y="4" width="2" height="8" rx="0.6" className="np-bar np-bar--2" />
      <rect x="11.5" y="6" width="2" height="4" rx="0.6" className="np-bar np-bar--3" />
    </svg>
  );
}
