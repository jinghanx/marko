import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace, getActiveSession } from '../state/workspace';
import { useSettings, buildSearchUrl } from '../state/settings';
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
  openChatTab,
  openSearchTab,
  openHttpTab,
  openClipboardTab,
  openSettingsTab,
  withReplace,
} from '../lib/actions';

interface Command {
  /** First keyword is the canonical name; rest are aliases. */
  keywords: string[];
  label: string;
  /** Short tag rendered as a category label in the suggestion row. */
  category: string;
  run: () => void;
}

const COMMANDS: Command[] = [
  {
    keywords: ['terminal', 'term', 'shell', 'tty'],
    label: 'Open Terminal',
    category: 'Terminal',
    run: () => openTerminalTab(),
  },
  {
    keywords: ['chat', 'ai', 'assistant', 'gpt', 'llm'],
    label: 'Open AI Chat',
    category: 'AI',
    run: () => openChatTab(),
  },
  {
    keywords: ['search', 'find', 'grep', 'rg'],
    label: 'Find in Files (ripgrep)',
    category: 'Search',
    run: () => openSearchTab(),
  },
  {
    keywords: ['git', 'status', 'commit'],
    label: 'Open Git (status / stage / commit)',
    category: 'Git',
    run: () => openGitTab(),
  },
  {
    keywords: ['http', 'request', 'rest', 'api', 'curl', 'postman'],
    label: 'Open HTTP Client',
    category: 'HTTP',
    run: () => openHttpTab(),
  },
  {
    keywords: ['whiteboard', 'draw', 'excalidraw', 'sketch', 'canvas'],
    label: 'Open Whiteboard (Excalidraw)',
    category: 'Whiteboard',
    run: () => openExcalidrawTab(),
  },
  {
    keywords: ['clipboard', 'pasteboard', 'paste', 'clip'],
    label: 'Open Clipboard History',
    category: 'Clipboard',
    run: () => openClipboardTab(),
  },
  {
    keywords: ['settings', 'preferences', 'prefs', 'config', 'theme'],
    label: 'Open Settings',
    category: 'Settings',
    run: () => openSettingsTab(),
  },
  {
    keywords: ['activity', 'processes', 'process', 'top', 'htop'],
    label: 'Open Activity (process viewer)',
    category: 'Activity',
    run: () => openProcessTab(),
  },
  {
    keywords: ['notes', 'note', 'scratchpad'],
    label: 'Open Notes (~/.marko/notes.txt)',
    category: 'Notes',
    run: async () => {
      const file = await window.marko.notesPath();
      await openFileFromPath(file, { focus: true });
    },
  },
];

/** Discriminated union — every suggestion row is one of these. Note that
 *  workspace file matches are intentionally NOT here: ⌘P (Quick Open) owns
 *  fuzzy file search + recent files, ⌘T owns commands / URLs / typed paths.
 *  Splitting the two stops the palettes from feeling like duplicates. */
type Suggestion =
  | { kind: 'command'; cmd: Command; key: string }
  | { kind: 'url'; url: string; key: string }
  | { kind: 'path'; absPath: string; name: string; isDirectory: boolean; key: string }
  | { kind: 'web-search'; query: string; key: string };

const MAX_LIST = 12;

interface Props {
  open: boolean;
  replace?: boolean;
  onClose: () => void;
}

function fuzzy(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function PathInput({ open, replace = false, onClose }: Props) {
  const rootDir = useWorkspace((s) => getActiveSession(s).rootDir);
  const settingsState = useSettings();
  const recentUrls = settingsState.recentUrls;

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pathChildren, setPathChildren] = useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const homeDirRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue('');
    setError(null);
    setBusy(false);
    setPathChildren([]);
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    if (!homeDirRef.current) {
      window.marko.homeDir().then((h) => (homeDirRef.current = h));
    }
  }, [open]);

  // Resolve typed value to an absolute path for filesystem suggestions.
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

  // Live load directory contents for path-style autocompletion.
  useEffect(() => {
    if (!open) {
      setPathChildren([]);
      return;
    }
    const trimmed = value.trim();
    // Path autocomplete only kicks in for path-shaped input — anything that
    // contains a slash, starts with `~`, or starts with `.` / `/`.
    const looksPathy =
      !!trimmed &&
      !looksLikeUrl(trimmed) &&
      (trimmed.includes('/') ||
        trimmed.startsWith('~') ||
        trimmed.startsWith('.') ||
        trimmed.startsWith('/'));
    if (!looksPathy) {
      setPathChildren([]);
      return;
    }
    const resolved = resolvePath(value);
    const slash = resolved.lastIndexOf('/');
    if (slash < 0) {
      setPathChildren([]);
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
        const considered = lc.startsWith('.')
          ? sorted
          : sorted.filter((e) => !e.name.startsWith('.'));
        const matches = considered.filter((e) => e.name.toLowerCase().startsWith(lc));
        const filtered =
          matches.length === 1 && matches[0].name === prefix ? [] : matches;
        const out: Suggestion[] = filtered.slice(0, 8).map((e) => ({
          kind: 'path',
          name: e.name,
          isDirectory: e.isDirectory,
          absPath: parent + (parent.endsWith('/') ? '' : '/') + e.name,
          key: `path:${parent}/${e.name}`,
        }));
        setPathChildren(out);
      })
      .catch(() => setPathChildren([]));
    return () => {
      cancelled = true;
    };
  }, [value, open, rootDir]);

  // Build the unified suggestion list. Order priority:
  //   1. Path completions (when typing a pathy thing).
  //   2. Matching commands.
  //   3. Matching recent URLs.
  // Workspace files are intentionally NOT shown here — that's ⌘P's job.
  const suggestions: Suggestion[] = useMemo(() => {
    const trimmed = value.trim();
    const q = trimmed.toLowerCase();
    const out: Suggestion[] = [];
    const seen = new Set<string>();
    const push = (s: Suggestion) => {
      if (seen.has(s.key)) return;
      seen.add(s.key);
      out.push(s);
    };

    for (const s of pathChildren) push(s);

    const cmdMatches: Command[] = trimmed
      ? COMMANDS.filter((c) => c.keywords.some((k) => k.startsWith(q)))
      : COMMANDS;
    for (const cmd of cmdMatches) {
      push({ kind: 'command', cmd, key: `cmd:${cmd.keywords[0]}` });
    }

    const urlMatches = trimmed
      ? recentUrls.filter((u) => fuzzy(u, q))
      : recentUrls.slice(0, 5);
    for (const u of urlMatches.slice(0, 5)) {
      push({ kind: 'url', url: u, key: `url:${u}` });
    }

    // Web-search fallback: when the user has typed something that's clearly
    // not a URL and not a path, offer to send it to Google. This is what
    // browser address bars do, and it makes ⌘T a useful end-of-thought
    // catch-all instead of erroring on free-text input.
    if (trimmed && !looksLikeUrl(trimmed)) {
      const isPathy =
        trimmed.includes('/') || trimmed.startsWith('~') || trimmed.startsWith('.');
      if (!isPathy) {
        push({ kind: 'web-search', query: trimmed, key: `search:${trimmed}` });
      }
    }

    return out.slice(0, MAX_LIST);
  }, [value, pathChildren, recentUrls]);

  // Keep activeIndex in range as suggestions change.
  useEffect(() => {
    if (activeIndex >= suggestions.length) setActiveIndex(0);
  }, [suggestions, activeIndex]);

  if (!open) return null;

  /** Run whatever the suggestion represents, closing the modal. */
  const runSuggestion = async (s: Suggestion) => {
    if (s.kind === 'command') {
      onClose();
      if (replace) await withReplace(() => s.cmd.run());
      else s.cmd.run();
      return;
    }
    if (s.kind === 'url') {
      onClose();
      if (replace) await withReplace(() => openUrlInTab(s.url));
      else openUrlInTab(s.url);
      return;
    }
    if (s.kind === 'web-search') {
      const { url } = buildSearchUrl(settingsState, s.query);
      onClose();
      if (replace) await withReplace(() => openUrlInTab(url));
      else openUrlInTab(url);
      return;
    }
    if (s.kind === 'path') {
      // Click/Enter on a path child: stat to decide folder vs file; Tab key
      // (handled below) extends input instead of opening, letting the user
      // drill into directories.
      setBusy(true);
      try {
        const stat = await window.marko.stat(s.absPath);
        if (!stat.exists) {
          setError(`Path doesn't exist: ${s.absPath}`);
          return;
        }
        onClose();
        const op = stat.isDirectory || s.isDirectory
          ? () => openFolderInEditor(s.absPath, { focus: true })
          : () => openFileFromPath(s.absPath, { focus: true });
        if (replace) await withReplace(op);
        else await op();
      } finally {
        setBusy(false);
      }
    }
  };

  /** Submit using whatever's typed (no list selection / fallback). */
  const submitTyped = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
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
      const op = stat.isDirectory
        ? () => openFolderInEditor(resolved, { focus: true })
        : () => openFileFromPath(resolved, { focus: true });
      if (replace) await withReplace(op);
      else await op();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const active = suggestions[activeIndex];
      if (active) void runSuggestion(active);
      else void submitTyped();
    } else if (e.key === 'ArrowDown') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Tab') {
      // Tab extends the input toward the active suggestion when meaningful:
      //   - command → fill the canonical keyword
      //   - path child → append the name (so user can keep typing into a dir)
      const active = suggestions[activeIndex];
      if (!active) return;
      e.preventDefault();
      if (active.kind === 'command') {
        setValue(active.cmd.keywords[0]);
      } else if (active.kind === 'path') {
        const slash = value.lastIndexOf('/');
        const head = slash >= 0 ? value.slice(0, slash + 1) : '';
        setValue(head + active.name + (active.isDirectory ? '/' : ''));
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
            ? 'Path, URL, or command — replaces current tab…'
            : 'Path, URL, or command (try chat, git, find, http…)'}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
        />
        {suggestions.length > 0 && (
          <div className="palette-results pathinput-suggestions">
            {suggestions.map((s, i) => (
              <SuggestionRow
                key={s.key}
                s={s}
                active={i === activeIndex}
                searchHost={buildSearchUrl(settingsState, '').host}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => void runSuggestion(s)}
              />
            ))}
          </div>
        )}
        <div className="pathinput-meta">
          {error ? (
            <span className="pathinput-error">{error}</span>
          ) : value && looksLikeUrl(value.trim()) ? (
            <span className="pathinput-resolved" title={normalizeUrl(value)}>
              🌐 {normalizeUrl(value)}
            </span>
          ) : value && !suggestions.find((s) => s.kind === 'path') ? (
            <span className="pathinput-resolved" title={resolvePath(value)}>
              → {resolvePath(value)}
            </span>
          ) : !value ? (
            <span className="pathinput-hint">
              Pick a tab kind, paste a URL, or start typing a path. <kbd>↑↓</kbd> to navigate.
            </span>
          ) : null}
        </div>
        <div className="palette-footer">
          <span><kbd>↵</kbd> open</span>
          {suggestions.length > 0 && <span><kbd>↑↓</kbd> select</span>}
          {suggestions.length > 0 && <span><kbd>Tab</kbd> extend</span>}
          <span><kbd>esc</kbd> cancel</span>
          {busy && <span>working…</span>}
        </div>
      </div>
    </div>
  );
}

function SuggestionRow({
  s,
  active,
  searchHost,
  onMouseEnter,
  onClick,
}: {
  s: Suggestion;
  active: boolean;
  searchHost: string;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  let glyph: React.ReactNode;
  let title: React.ReactNode;
  let subtitle: React.ReactNode = null;
  let tag: string | null = null;

  if (s.kind === 'command') {
    glyph = '⌘';
    title = s.cmd.keywords[0];
    subtitle = s.cmd.label;
    tag = s.cmd.category;
  } else if (s.kind === 'url') {
    glyph = '🌐';
    let host = s.url;
    try {
      host = new URL(s.url).hostname;
    } catch {
      // ignore
    }
    title = host;
    subtitle = s.url;
    tag = 'URL';
  } else if (s.kind === 'web-search') {
    glyph = '🔍';
    title = `Search the web for "${s.query}"`;
    subtitle = searchHost;
    tag = 'Search';
  } else {
    glyph = s.isDirectory ? '📁' : '📄';
    title = s.name + (s.isDirectory ? '/' : '');
    subtitle = null;
  }

  return (
    <div
      className={`palette-row pathinput-suggestion${active ? ' palette-row--active' : ''}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="pathinput-suggestion-glyph">{glyph}</span>
      <span className="pathinput-suggestion-main">
        <span className="pathinput-suggestion-title">{title}</span>
        {subtitle && <span className="pathinput-suggestion-sub">{subtitle}</span>}
      </span>
      {tag && <span className="pathinput-suggestion-tag">{tag}</span>}
    </div>
  );
}
