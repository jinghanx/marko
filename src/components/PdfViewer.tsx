import { useMemo } from 'react';

interface Props {
  filePath: string;
  title: string;
}

/** PDF tab. Streams from disk through the privileged `marko-file://` protocol
 *  into Chromium's built-in PDF viewer (enabled via `plugins: true` in
 *  webPreferences). No external library — the embed gets the full native
 *  toolbar (zoom, page nav, search, print, download). */
export function PdfViewer({ filePath, title }: Props) {
  const src = useMemo(
    () => `marko-file://stream${encodeURI(filePath)}`,
    [filePath],
  );
  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <span className="pdf-name" title={filePath}>
          {title}
        </span>
        <span className="pdf-kind">PDF</span>
      </div>
      <div className="pdf-canvas">
        <embed src={src} type="application/pdf" />
      </div>
    </div>
  );
}
