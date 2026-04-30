import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../state/workspace';
import { openFileFromPath, openFolderInEditor, looksLikeUrl, normalizeUrl, openUrlInTab } from '../lib/actions';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PathInput({ open, onClose }: Props) {
  const rootDir = useWorkspace((s) => s.rootDir);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const homeDirRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue('');
    setError(null);
    setBusy(false);
    requestAnimationFrame(() => inputRef.current?.focus());
    if (!homeDirRef.current) {
      window.marko.homeDir().then((h) => (homeDirRef.current = h));
    }
  }, [open]);

  if (!open) return null;

  const resolvePath = (input: string): string => {
    let p = input.trim();
    if (!p) return p;
    if (p === '~') p = homeDirRef.current ?? p;
    else if (p.startsWith('~/') && homeDirRef.current) {
      p = homeDirRef.current + p.slice(1);
    } else if (!p.startsWith('/')) {
      const base = rootDir ?? homeDirRef.current ?? '';
      p = base + (base.endsWith('/') ? '' : '/') + p;
    }
    return p;
  };

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (looksLikeUrl(trimmed)) {
      onClose();
      openUrlInTab(trimmed);
      return;
    }
    const resolved = resolvePath(trimmed);
    if (!resolved) return;
    setBusy(true);
    setError(null);
    try {
      const stat = await window.marko.stat(resolved);
      if (!stat.exists) {
        setError(`Path doesn't exist: ${resolved}`);
        return;
      }
      onClose();
      if (stat.isDirectory) {
        await openFolderInEditor(resolved, { focus: true });
      } else {
        await openFileFromPath(resolved, { focus: true });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div className="palette pathinput" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          value={value}
          placeholder="Enter a path… (~ , relative to workspace, or absolute)"
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
        />
        <div className="pathinput-meta">
          {error ? (
            <span className="pathinput-error">{error}</span>
          ) : value && looksLikeUrl(value.trim()) ? (
            <span className="pathinput-resolved" title={normalizeUrl(value)}>
              🌐 {normalizeUrl(value)}
            </span>
          ) : value ? (
            <span className="pathinput-resolved" title={resolvePath(value)}>
              → {resolvePath(value)}
            </span>
          ) : (
            <span className="pathinput-hint">
              Try: <code>~/Documents</code>, <code>./README.md</code>, <code>https://news.ycombinator.com</code>
            </span>
          )}
        </div>
        <div className="palette-footer">
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> cancel</span>
          {busy && <span>working…</span>}
        </div>
      </div>
    </div>
  );
}
