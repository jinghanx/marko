import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchMatch } from '../types/marko';
import { useWorkspace, getActiveSession } from '../state/workspace';
import { openFileFromPath } from '../lib/actions';

const DEBOUNCE_MS = 300;
const MAX_RESULTS = 2000;

interface FileGroup {
  path: string;
  matches: SearchMatch[];
}

/** Find-in-files (ripgrep). Streams match events from main as the user types
 *  (debounced); groups by file in the result list; click to open the file. */
export function SearchView() {
  const rootDir = useWorkspace((s) => getActiveSession(s).rootDir);

  const [query, setQuery] = useState('');
  const [glob, setGlob] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const reqIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Cancel any in-flight search on unmount.
  useEffect(() => {
    return () => {
      const id = reqIdRef.current;
      if (id) void window.marko.searchCancel(id);
    };
  }, []);

  // Debounced run on query/options change.
  useEffect(() => {
    if (!rootDir || !query.trim()) {
      setMatches([]);
      setError(null);
      return;
    }
    const handle = setTimeout(() => {
      void runSearch();
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, glob, caseSensitive, regex, wholeWord, rootDir]);

  const runSearch = async () => {
    if (!rootDir) return;
    // Cancel any prior in-flight search.
    const prior = reqIdRef.current;
    if (prior) {
      await window.marko.searchCancel(prior);
    }
    const reqId = `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    reqIdRef.current = reqId;
    setMatches([]);
    setError(null);
    setRunning(true);

    let collected: SearchMatch[] = [];
    let stopped = false;
    const offMatch = window.marko.onSearchMatch(reqId, (m) => {
      if (stopped) return;
      collected.push(m);
      // Throttle setState — flush in batches of 32 to keep React render cheap.
      if (collected.length % 32 === 0 || collected.length === 1) {
        setMatches([...collected]);
      }
      if (collected.length >= MAX_RESULTS) {
        stopped = true;
        void window.marko.searchCancel(reqId);
      }
    });
    const offDone = window.marko.onSearchDone(reqId, (r) => {
      offMatch();
      offDone();
      setMatches([...collected]);
      setRunning(false);
      if (!r.ok) setError(r.error ?? 'Search failed');
      reqIdRef.current = null;
    });

    const start = await window.marko.searchStart(reqId, {
      rootDir,
      query,
      caseSensitive,
      regex,
      wholeWord,
      glob: glob.trim() || undefined,
    });
    if (!start.ok) {
      offMatch();
      offDone();
      setRunning(false);
      setError(start.error ?? 'Could not start search');
      reqIdRef.current = null;
    }
  };

  const cancel = () => {
    const id = reqIdRef.current;
    if (id) void window.marko.searchCancel(id);
  };

  // Group matches by file path.
  const groups: FileGroup[] = useMemo(() => {
    const map = new Map<string, SearchMatch[]>();
    for (const m of matches) {
      const arr = map.get(m.path) ?? [];
      arr.push(m);
      map.set(m.path, arr);
    }
    return Array.from(map.entries()).map(([path, ms]) => ({ path, matches: ms }));
  }, [matches]);

  const toggleCollapse = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openMatch = (m: SearchMatch) => {
    void openFileFromPath(m.path, { focus: true });
    // Line jump: ride the existing uiBus 'goto-line' which CodeEditor
    // listens for. (If the editor doesn't support it, this is a no-op.)
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('marko:goto-line', { detail: { path: m.path, line: m.lineNumber } }),
      );
    }, 60);
  };

  if (!rootDir) {
    return (
      <div className="search-view search-view--empty">
        <div className="search-empty-title">No workspace open</div>
        <div className="search-empty-sub">Open a folder with ⌘⇧O to search across files.</div>
      </div>
    );
  }

  return (
    <div className="search-view">
      <div className="search-toolbar">
        <input
          ref={inputRef}
          className="search-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find in files…"
          autoFocus
          spellCheck={false}
        />
        <input
          className="search-glob"
          value={glob}
          onChange={(e) => setGlob(e.target.value)}
          placeholder="*.{ts,tsx} (glob)"
          spellCheck={false}
        />
        <div className="search-flags">
          <label className="search-flag" title="Match case">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
            />
            <span>Aa</span>
          </label>
          <label className="search-flag" title="Whole word">
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(e) => setWholeWord(e.target.checked)}
            />
            <span>\b</span>
          </label>
          <label className="search-flag" title="Regex">
            <input
              type="checkbox"
              checked={regex}
              onChange={(e) => setRegex(e.target.checked)}
            />
            <span>.*</span>
          </label>
        </div>
        {running && (
          <button className="search-cancel" onClick={cancel}>
            Stop
          </button>
        )}
      </div>

      <div className="search-summary">
        {error ? (
          <span className="search-error">{error}</span>
        ) : query.trim() === '' ? (
          <span className="search-hint">
            Type to search. Uses <code>ripgrep</code> over <code>{rootDir}</code>.
          </span>
        ) : matches.length === 0 && !running ? (
          <span className="search-hint">No matches.</span>
        ) : (
          <span className="search-hint">
            {matches.length}
            {matches.length >= MAX_RESULTS ? '+' : ''} match{matches.length === 1 ? '' : 'es'} in{' '}
            {groups.length} file{groups.length === 1 ? '' : 's'}
            {running && ' · searching…'}
          </span>
        )}
      </div>

      <div className="search-results">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.path);
          const rel = relativize(g.path, rootDir);
          return (
            <div key={g.path} className="search-file-group">
              <div
                className="search-file-header"
                onClick={() => toggleCollapse(g.path)}
              >
                <span className="search-file-arrow">{isCollapsed ? '▶' : '▼'}</span>
                <span className="search-file-path" title={g.path}>
                  {rel}
                </span>
                <span className="search-file-count">{g.matches.length}</span>
              </div>
              {!isCollapsed &&
                g.matches.map((m, i) => (
                  <div
                    key={i}
                    className="search-match"
                    onClick={() => openMatch(m)}
                    title={`${rel}:${m.lineNumber}`}
                  >
                    <span className="search-match-line">{m.lineNumber}</span>
                    <span className="search-match-text">
                      {renderLine(m.text, m.submatches)}
                    </span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function relativize(p: string, root: string): string {
  if (root && p.startsWith(root + '/')) return p.slice(root.length + 1);
  return p;
}

function renderLine(text: string, submatches: Array<{ start: number; end: number }>) {
  // Submatches give us byte ranges within the rg-emitted line.text. Our text
  // is already a JS string, but for ASCII / latin chars the byte index matches
  // the char index. For exotic UTF-8 we'd need a byte-to-char map; for v1 we
  // index directly which works for the vast majority of code/text.
  const out: React.ReactNode[] = [];
  let cur = 0;
  // Normalize: drop trailing newline rg sometimes includes.
  const line = text.replace(/\n$/, '');
  for (let i = 0; i < submatches.length; i++) {
    const s = submatches[i];
    if (s.start > cur) out.push(line.slice(cur, s.start));
    out.push(
      <mark key={i} className="search-mark">
        {line.slice(s.start, s.end)}
      </mark>,
    );
    cur = s.end;
  }
  if (cur < line.length) out.push(line.slice(cur));
  return out;
}
