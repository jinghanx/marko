import { useEffect, useState } from 'react';

interface UpdateInfo {
  version: string;
  url: string;
}

/** Bottom-right toast that appears when the main process detects a
 *  newer release on GitHub. Click "Download" to open the release page
 *  in the default browser; "Dismiss" hides for the rest of this
 *  session (next launch may surface it again if still pending). */
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    return window.milu.onUpdateAvailable((data) => setUpdate(data));
  }, []);

  if (!update) return null;

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <div className="update-banner-icon" aria-hidden>↑</div>
      <div className="update-banner-text">
        <div className="update-banner-title">Milu v{update.version} is available</div>
        <div className="update-banner-sub">A new release is up on GitHub.</div>
      </div>
      <div className="update-banner-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            void window.milu.shellOpenExternal(update.url);
            setUpdate(null);
          }}
        >
          Download
        </button>
        <button
          type="button"
          className="update-banner-dismiss"
          onClick={() => setUpdate(null)}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
