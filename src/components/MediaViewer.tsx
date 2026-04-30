import { useEffect, useMemo, useRef } from 'react';
import { isVideoExt } from '../lib/fileType';
import { workspace } from '../state/workspace';

interface Props {
  tabId: string;
  filePath: string;
  title: string;
}

/** Renders mp3/mp4-style files with native <audio>/<video> controls. The
 *  source streams over the privileged `marko-file://` protocol registered in
 *  electron/main.ts, so seeking works (HTTP range requests) without buffering
 *  the whole clip. */
export function MediaViewer({ tabId, filePath, title }: Props) {
  const src = useMemo(
    () => `marko-file://stream${encodeURI(filePath)}`,
    [filePath],
  );
  const isVideo = isVideoExt(filePath);
  const elRef = useRef<HTMLMediaElement | null>(null);

  // Surface play/pause state to the workspace so the titlebar's now-playing
  // button can show this tab and jump back here.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onPlay = () => workspace.setTabPlaying(tabId, true);
    const onStop = () => workspace.setTabPlaying(tabId, false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onStop);
    el.addEventListener('ended', onStop);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onStop);
      el.removeEventListener('ended', onStop);
      workspace.setTabPlaying(tabId, false);
    };
  }, [tabId, src]);

  return (
    <div className={`media-viewer ${isVideo ? 'media-viewer--video' : 'media-viewer--audio'}`}>
      <div className="media-toolbar">
        <span className="media-name" title={filePath}>
          {title}
        </span>
        <span className="media-kind">{isVideo ? 'video' : 'audio'}</span>
      </div>
      <div className="media-canvas">
        {isVideo ? (
          <video
            ref={(node) => {
              elRef.current = node;
            }}
            src={src}
            controls
            preload="metadata"
          />
        ) : (
          <audio
            ref={(node) => {
              elRef.current = node;
            }}
            src={src}
            controls
            preload="metadata"
          />
        )}
      </div>
    </div>
  );
}
