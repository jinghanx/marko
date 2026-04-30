import { useEffect, useMemo, useState } from 'react';
import { diffLines, type Change } from 'diff';

interface Props {
  leftPath: string;
  rightPath: string;
}

interface FileSide {
  path: string;
  content: string | null;
  error: string | null;
}

/** Unified line diff between two files. Reads both via the existing file IPC,
 *  uses jsdiff to compute change chunks, renders a unified view with line
 *  numbers and color-coded gutter. */
export function DiffViewer({ leftPath, rightPath }: Props) {
  const [left, setLeft] = useState<FileSide>({ path: leftPath, content: null, error: null });
  const [right, setRight] = useState<FileSide>({ path: rightPath, content: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setLeft({ path: leftPath, content: null, error: null });
    window.marko
      .readFile(leftPath)
      .then((c) => !cancelled && setLeft({ path: leftPath, content: c, error: null }))
      .catch((e: Error) =>
        !cancelled && setLeft({ path: leftPath, content: null, error: e.message }),
      );
    return () => {
      cancelled = true;
    };
  }, [leftPath]);

  useEffect(() => {
    let cancelled = false;
    setRight({ path: rightPath, content: null, error: null });
    window.marko
      .readFile(rightPath)
      .then((c) => !cancelled && setRight({ path: rightPath, content: c, error: null }))
      .catch((e: Error) =>
        !cancelled && setRight({ path: rightPath, content: null, error: e.message }),
      );
    return () => {
      cancelled = true;
    };
  }, [rightPath]);

  const changes: Change[] | null = useMemo(() => {
    if (left.content === null || right.content === null) return null;
    return diffLines(left.content, right.content);
  }, [left.content, right.content]);

  return (
    <div className="diff-viewer">
      <div className="diff-toolbar">
        <span className="diff-side diff-side--left" title={left.path}>
          <span className="diff-side-marker">−</span>
          {left.path}
        </span>
        <span className="diff-side diff-side--right" title={right.path}>
          <span className="diff-side-marker">+</span>
          {right.path}
        </span>
      </div>
      {(left.error || right.error) && (
        <div className="diff-error">
          {left.error && <div>left: {left.error}</div>}
          {right.error && <div>right: {right.error}</div>}
        </div>
      )}
      {changes && <DiffBody changes={changes} />}
      {!changes && !left.error && !right.error && (
        <div className="diff-loading">Loading…</div>
      )}
    </div>
  );
}

function DiffBody({ changes }: { changes: Change[] }) {
  // Walk changes to assign per-side line numbers. Removed lines advance only
  // the left counter; added lines advance only the right; unchanged advance
  // both.
  let leftLine = 0;
  let rightLine = 0;
  const rendered: React.ReactNode[] = [];

  changes.forEach((change, ci) => {
    const lines = change.value.endsWith('\n')
      ? change.value.slice(0, -1).split('\n')
      : change.value.split('\n');
    for (const line of lines) {
      let leftNo: number | null = null;
      let rightNo: number | null = null;
      let cls = 'diff-line';
      let marker = ' ';
      if (change.added) {
        rightLine++;
        rightNo = rightLine;
        cls += ' diff-line--added';
        marker = '+';
      } else if (change.removed) {
        leftLine++;
        leftNo = leftLine;
        cls += ' diff-line--removed';
        marker = '−';
      } else {
        leftLine++;
        rightLine++;
        leftNo = leftLine;
        rightNo = rightLine;
      }
      rendered.push(
        <div key={`${ci}-${rendered.length}`} className={cls}>
          <span className="diff-num diff-num--left">{leftNo ?? ''}</span>
          <span className="diff-num diff-num--right">{rightNo ?? ''}</span>
          <span className="diff-marker">{marker}</span>
          <span className="diff-text">{line}</span>
        </div>,
      );
    }
  });

  return <div className="diff-body">{rendered}</div>;
}
