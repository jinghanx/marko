import { useEffect, useRef, useState } from 'react';

interface Props {
  src: string;
  filePath: string | null;
  title: string;
}

type FitMode = 'fit' | 'actual';

export function ImageViewer({ src, filePath, title }: Props) {
  const [fitMode, setFitMode] = useState<FitMode>('fit');
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setDims(null);
  }, [src]);

  return (
    <div className="image-viewer">
      <div className="image-toolbar">
        <div className="image-meta">
          <span className="image-name" title={filePath ?? title}>
            {title}
          </span>
          {dims && (
            <span className="image-dims">
              {dims.w} × {dims.h}
            </span>
          )}
        </div>
        <div className="image-zoom">
          <button
            className={`seg-control-item ${fitMode === 'fit' ? 'seg-control-item--active' : ''}`}
            onClick={() => setFitMode('fit')}
          >
            Fit
          </button>
          <button
            className={`seg-control-item ${fitMode === 'actual' ? 'seg-control-item--active' : ''}`}
            onClick={() => setFitMode('actual')}
          >
            100%
          </button>
        </div>
      </div>
      <div className={`image-canvas image-canvas--${fitMode}`}>
        <img
          ref={imgRef}
          src={src}
          alt={title}
          draggable={false}
          onLoad={(e) => {
            const im = e.currentTarget;
            setDims({ w: im.naturalWidth, h: im.naturalHeight });
          }}
        />
      </div>
    </div>
  );
}
