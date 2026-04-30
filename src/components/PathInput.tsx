import { useEffect, useRef, useState } from 'react';
import { useWorkspace, getActiveSession } from '../state/workspace';
import {
  openFileFromPath,
  openFolderInEditor,
  looksLikeUrl,
  normalizeUrl,
  openUrlInTab,
  openTerminalTab,
  openProcessTab,
  openGitTab,
  openExcalidrawTab,
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
  {
    keywords: ['activity', 'processes', 'process', 'top', 'htop'],
    label: 'Open Activity (process viewer)',
    run: () => openProcessTab(),
  },
  {
    keywords: ['git', 'status', 'commit'],
    label: 'Open Git (status / stage / commit)',
    run: () => openGitTab(),
  },
  {
    keywords: ['whiteboard', 'draw', 'excalidraw', 'sketch', 'canvas'],
    label: 'Open Whiteboard (Excalidraw)',
    run: () => openExcalidrawTab(),
  },
  {
    keywords: ['notes', 'note', 'scratchpad'],
    label: 'Open Notes (~/.marko/notes.txt)',
    run: async () => {
      const file = await window.marko.notesPath();
      await openFileFromPath(file, { focus: true });
    },
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

interface Suggestion {
  name: string;
  isDirectory: boolean;
  /** Absolute filesystem path of the suggestion. */
  absPath: string;
}

const MAX_SUGGESTIONS = 8;

interface Props {
  open: boolean;
  replace?: boolean;
  onClose: () => void;
}

export function PathInput({ open, replace = false, onClose }: Props) {
  const rootDir = useWorkspace((s) => getActiveSession(s).rootDir);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const homeDirRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue('');
    setError(null);
    setBusy(false);
    setSuggestions([]);
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    if (!homeDirRef.current) {
      window.marko.homeDir().then((h) => (homeDirRef.current = h));
    }
  }, [open]);

  // Resolve typed value to an absolute path.
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

  // Live multi-suggestion autocomplete: list the resolved parent dir and find
  // entries whose name starts with the typed prefix.
  useEffect(() => {
    if (!open) {
      setSuggestions([]);
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      setSuggestions([]);
      setActiveIndex(0);
      return;
    }
    if (looksLikeUrl(trimmed) || matchCommand(trimmed)) {
      setSuggestions([]);
      setActiveIndex(0);
      return;
    }
    const resolved = resolvePath(value);
    const slash = resolved.lastIndexOf('/');
    if (slash < 0) {
      setSuggestions([]);
      setActiveIndex(0);
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
        const matches = considered
          .filter((e) => e.name.toLowerCase().startsWith(lc))
          .slice(0, MAX_SUGGESTIONS)
          .map<Suggestion>((e) => ({
            name: e.name,
            isDirectory: e.isDirectory,
            absPath: parent + (parent.endsWith('/') ? '' : '/') + e.name,
          }));
        // If the only match is exactly what's typed, hide it (nothing to add).
        const filtered =
          matches.length === 1 && matches[0].name === prefix ? [] : matches;
        setSuggestions(filtered);
        setActiveIndex(0);
      })
      .catch(() => {
        setSuggestions([]);
        setActiveIndex(0);
      });
    return () => {
      cancelled = true;
    };
  }, [value, open, rootDir]);

  if (!open) return null;

  /** Take the current input value and replace its trailing path segment with
   *  the suggestion's name (preserving the parent the user already typed). */
  const acceptSuggestion = (s: Suggestion): string => {
    const slash = value.lastIndexOf('/');
    const head = slash >= 0 ? value.slice(0, slash + 1) : '';
    return head + s.name + (s.isDirectory ? '/' : '');
  };

  const submit = async (overridePath?: string) => {
    const trimmed = value.trim();
    if (!trimmed && !overridePath) return;
    if (!overridePath) {
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
    }
    const resolved = overridePath ?? resolvePath(trimmed);
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
      // If the user has navigated to a suggestion and it differs from what's
      // typed, treat Enter as "submit this suggestion." For directories, this
      // opens the folder; the user can drill in further with Tab if they want.
      const active = suggestions[activeIndex];
      if (active) {
        void submit(active.absPath);
      } else {
        void submit();
      }
    } else if (e.key === 'ArrowDown') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Tab') {
      // Tab: command completion takes priority (when a command keyword
      // partially matches), then path completion via the active suggestion.
      const cmd = matchCommand(value);
      if (cmd && cmd.completion !== value.trim().toLowerCase()) {
        e.preventDefault();
        setValue(cmd.completion);
        return;
      }
      const active = suggestions[activeIndex];
      if (active) {
        e.preventDefault();
        setValue(acceptSuggestion(active));
        // After accepting, suggestions will refresh on the next value change.
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const trimmed = value.trim();
  const cmdMatch = matchCommand(trimmed);
  const showSuggestions = suggestions.length > 0 && !cmdMatch && !looksLikeUrl(trimmed);

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
        {showSuggestions && (
          <div className="palette-results pathinput-suggestions">
            {suggestions.map((s, i) => (
              <div
                key={s.absPath}
                className={`palette-row pathinput-suggestion${i === activeIndex ? ' palette-row--active' : ''}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => void submit(s.absPath)}
              >
                <span className="palette-row-name">
                  {s.isDirectory ? '📁 ' : '📄 '}
                  {s.name}
                  {s.isDirectory && '/'}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="pathinput-meta">
          {(() => {
            if (error) return <span className="pathinput-error">{error}</span>;
            if (cmdMatch) {
              const tail = cmdMatch.completion.slice(trimmed.length);
              return (
                <span className="pathinput-resolved">
                  ⌘ <strong>{trimmed}</strong>
                  {tail && <span className="pathinput-ghost">{tail}</span>}
                  {' — '}
                  {cmdMatch.cmd.label}
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
              const active = suggestions[activeIndex];
              const target = active ? active.absPath : resolvePath(value);
              return (
                <span className="pathinput-resolved" title={target}>
                  → {target}
                  {showSuggestions && (
                    <span className="pathinput-tab-hint"> (↑↓ to choose, Tab to extend)</span>
                  )}
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
          {showSuggestions && <span><kbd>↑↓</kbd> select</span>}
          {showSuggestions && <span><kbd>Tab</kbd> extend</span>}
          <span><kbd>esc</kbd> cancel</span>
          {busy && <span>working…</span>}
        </div>
      </div>
    </div>
  );
}
