import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../state/workspace';
import {
  openFileFromPath,
  openFolderInEditor,
  looksLikeUrl,
  normalizeUrl,
  openUrlInTab,
  openTerminalTab,
  withReplace,
} from '../lib/actions';

interface Command {
  /** First keyword is the canonical name; rest are aliases. */
  keywords: string[];
  label: string;
  run: () => void;
}

const COMMANDS: Command[] = [
  {
    keywords: ['terminal', 'term', 'shell', 'tty'],
    label: 'Open Terminal',
    run: () => openTerminalTab(),
  },
];

function matchCommand(input: string): { cmd: Command; completion: string } | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  for (const cmd of COMMANDS) {
    for (const kw of cmd.keywords) {
      if (kw.toLowerCase().startsWith(q)) {
        return { cmd, completion: kw };
      }
    }
  }
  return null;
}

interface Props {
  open: boolean;
  replace?: boolean;
  onClose: () => void;
}

export function PathInput({ open, replace = false, onClose }: Props) {
  const rootDir = useWorkspace((s) => s.rootDir);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [completion, setCompletion] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const homeDirRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue('');
    setError(null);
    setBusy(false);
    setCompletion(null);
    requestAnimationFrame(() => inputRef.current?.focus());
    if (!homeDirRef.current) {
      window.marko.homeDir().then((h) => (homeDirRef.current = h));
    }
  }, [open]);

  // Live path autocompletion: list the resolved parent dir and find an entry
  // whose name starts with the typed prefix.
  useEffect(() => {
    if (!open) {
      setCompletion(null);
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      setCompletion(null);
      return;
    }
    if (looksLikeUrl(trimmed) || matchCommand(trimmed)) {
      setCompletion(null);
      return;
    }
    // Resolve the typed value to an absolute path so we can list its parent.
    const resolved = (() => {
      let p = value;
      if (p === '~') return homeDirRef.current ?? p;
      if (p.startsWith('~/') && homeDirRef.current) return homeDirRef.current + p.slice(1);
      if (p.startsWith('/')) return p;
      const base = rootDir ?? homeDirRef.current ?? '';
      return base + (base.endsWith('/') ? '' : '/') + p;
    })();
    const slash = resolved.lastIndexOf('/');
    if (slash < 0) {
      setCompletion(null);
      return;
    }
    const parent = resolved.slice(0, slash) || '/';
    const prefix = resolved.slice(slash + 1);
    let cancelled = false;
    window.marko
      .listDir(parent)
      .then((entries) => {
        if (cancelled) return;
        const lc = prefix.toLowerCase();
        const sorted = [...entries].sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        // Skip dotfiles unless the user is explicitly typing one.
        const considered = lc.startsWith('.')
          ? sorted
          : sorted.filter((e) => !e.name.startsWith('.'));
        const match = considered.find(
          (e) => e.name.toLowerCase().startsWith(lc) && e.name !== prefix,
        );
        if (match) {
          const tail = match.name.slice(prefix.length);
          setCompletion(tail + (match.isDirectory ? '/' : ''));
        } else {
          setCompletion(null);
        }
      })
      .catch(() => setCompletion(null));
    return () => {
      cancelled = true;
    };
  }, [value, open, rootDir]);

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
    // Command match takes priority — only when the input exactly matches a
    // command's full keyword (so "term" autocompletes to "terminal" but doesn't
    // immediately fire if the user might be typing a path that starts with
    // those letters).
    const cmd = matchCommand(trimmed);
    if (cmd && cmd.completion === trimmed.toLowerCase()) {
      onClose();
      if (replace) await withReplace(() => cmd.cmd.run());
      else cmd.cmd.run();
      return;
    }
    if (looksLikeUrl(trimmed)) {
      onClose();
      if (replace) await withReplace(() => openUrlInTab(trimmed));
      else openUrlInTab(trimmed);
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
      const open = stat.isDirectory
        ? () => openFolderInEditor(resolved, { focus: true })
        : () => openFileFromPath(resolved, { focus: true });
      if (replace) await withReplace(open);
      else await open();
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
    } else if (e.key === 'Tab') {
      // Tab: command completion takes priority, then path completion.
      const cmd = matchCommand(value);
      if (cmd && cmd.completion !== value.trim().toLowerCase()) {
        e.preventDefault();
        setValue(cmd.completion);
        return;
      }
      if (completion) {
        e.preventDefault();
        setValue(value + completion);
        setCompletion(null);
      }
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
          placeholder={replace
            ? 'Enter a path — replaces current tab…'
            : 'Enter a path… (~ , relative to workspace, or absolute)'}
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
          {(() => {
            if (error) return <span className="pathinput-error">{error}</span>;
            const trimmed = value.trim();
            const cmd = matchCommand(trimmed);
            if (cmd) {
              const tail = cmd.completion.slice(trimmed.length);
              return (
                <span className="pathinput-resolved">
                  ⌘ <strong>{trimmed}</strong>
                  {tail && <span className="pathinput-ghost">{tail}</span>}
                  {' — '}
                  {cmd.cmd.label}
                  {tail && <span className="pathinput-tab-hint"> (Tab)</span>}
                </span>
              );
            }
            if (value && looksLikeUrl(trimmed)) {
              return (
                <span className="pathinput-resolved" title={normalizeUrl(value)}>
                  🌐 {normalizeUrl(value)}
                </span>
              );
            }
            if (value) {
              return (
                <span className="pathinput-resolved" title={resolvePath(value)}>
                  → {resolvePath(value)}
                  {completion && <span className="pathinput-ghost">{completion}</span>}
                  {completion && <span className="pathinput-tab-hint"> (Tab)</span>}
                </span>
              );
            }
            return (
              <span className="pathinput-hint">
                Try: <code>terminal</code>, <code>~/Documents</code>, <code>./README.md</code>,{' '}
                <code>https://news.ycombinator.com</code>
              </span>
            );
          })()}
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
