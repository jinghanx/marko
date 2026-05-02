import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LAUNCHER_COMMANDS, type LauncherCommand, type LauncherAction } from '../shared/launcherActions';
import { TabKindGlyph, GlobeGlyph } from '../components/TabKindGlyph';
import { CustomCursor } from './CustomCursor';
import { LauncherInput } from './LauncherInput';

interface AppEntry {
  name: string;
  path: string;
}

/** Discriminated union — every result row in the launcher list is one of these. */
type Result =
  | { kind: 'command'; cmd: LauncherCommand }
  | { kind: 'app'; app: AppEntry }
  | { kind: 'web-search'; query: string }
  | { kind: 'calculator'; expression: string; result: number };

const MAX_RESULTS = 12;

/** Try to evaluate `input` as a math expression. Returns null if it isn't
 *  a math-shaped string. Safe by construction: input is whitelisted to
 *  digits/operators/parens/dots/spaces, and the expression must contain
 *  at least one operator (so plain numbers don't get treated as math). */
function tryCalculate(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Whitelist: digits, operators, parens, dots, % for modulo, e for
  // scientific notation, spaces. Reject anything else.
  if (!/^[\d+\-*/().%eE\s]+$/.test(trimmed)) return null;
  // Must contain an operator (other than scientific-notation `e`) so
  // "42" alone doesn't render as a calculator result.
  if (!/[+\-*/%]/.test(trimmed)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${trimmed});`)();
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function formatCalcResult(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 10 });
}

/** Pick a stable hue for an app name so each app gets its own consistent
 *  letter-avatar color (hash-based, no randomness). */
function appHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function ResultRow({
  result,
  active,
  onMouseEnter,
  onClick,
}: {
  result: Result;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  let glyph: React.ReactNode;
  let title: string;
  let subtitle: string;
  let tag: string;
  if (result.kind === 'command') {
    glyph = (
      <span className={`launcher-row-tabicon launcher-row-tabicon--${result.cmd.iconKind}`}>
        <TabKindGlyph kind={result.cmd.iconKind} />
      </span>
    );
    title = result.cmd.keywords[0];
    subtitle = result.cmd.label;
    tag = result.cmd.category;
  } else if (result.kind === 'app') {
    const initials = result.app.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('');
    const hue = appHue(result.app.name);
    glyph = (
      <span
        className="launcher-row-avatar"
        style={{ background: `hsl(${hue} 60% 45%)` }}
      >
        {initials || '?'}
      </span>
    );
    title = result.app.name;
    subtitle = result.app.path;
    tag = 'App';
  } else if (result.kind === 'web-search') {
    glyph = (
      <span className="launcher-row-tabicon launcher-row-tabicon--web">
        <GlobeGlyph />
      </span>
    );
    title = `Search the web for "${result.query}"`;
    subtitle = 'opens in a Marko web tab';
    tag = 'Search';
  } else {
    glyph = '🧮';
    title = formatCalcResult(result.result);
    subtitle = `${result.expression}  · ↵ to copy`;
    tag = 'Math';
  }
  return (
    <div
      className={`launcher-row${active ? ' launcher-row--active' : ''}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="launcher-row-glyph">{glyph}</span>
      <span className="launcher-row-main">
        <span className="launcher-row-title">{title}</span>
        <span className="launcher-row-sub">{subtitle}</span>
      </span>
      <span className="launcher-row-tag">{tag}</span>
    </div>
  );
}

export function Launcher() {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [apps, setApps] = useState<AppEntry[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  // Reset state every time the launcher is shown — and re-fetch apps so a
  // newly-installed application appears without restarting Marko.
  useEffect(() => {
    const refresh = () => {
      window.marko.listApps().then(setApps).catch(() => {});
    };
    refresh();
    const off = window.markoLauncher.onShow(() => {
      setQuery('');
      setActiveIdx(0);
      refresh();
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    requestAnimationFrame(() => inputRef.current?.focus());
    return off;
  }, []);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Result[] = [];

    // Calculator: if the trimmed query parses as math, show the result
    // at the top — Spotlight/Raycast pattern.
    const calc = tryCalculate(query);
    if (calc !== null) {
      out.push({ kind: 'calculator', expression: query.trim(), result: calc });
    }

    // Commands: prefer keyword startsWith, then label substring.
    const cmdMatches = q
      ? LAUNCHER_COMMANDS.filter(
          (c) =>
            c.keywords.some((k) => k.startsWith(q)) ||
            c.label.toLowerCase().includes(q),
        )
      : LAUNCHER_COMMANDS;
    for (const cmd of cmdMatches) out.push({ kind: 'command', cmd });

    // Apps: name startsWith first, then substring. Only show on non-empty
    // query — an empty launcher shouldn't dump 100 apps below the commands.
    if (q) {
      const startsWith: AppEntry[] = [];
      const contains: AppEntry[] = [];
      for (const a of apps) {
        const lower = a.name.toLowerCase();
        if (lower.startsWith(q)) startsWith.push(a);
        else if (lower.includes(q)) contains.push(a);
      }
      for (const a of [...startsWith, ...contains]) {
        out.push({ kind: 'app', app: a });
      }
    }

    // Web-search fallback always at the bottom for non-empty input —
    // matches ⌘T's behavior so the user has an "anything else" option.
    const trimmed = query.trim();
    if (trimmed) {
      out.push({ kind: 'web-search', query: trimmed });
    }

    return out.slice(0, MAX_RESULTS);
  }, [query, apps]);

  // Clamp activeIdx if the list shrinks under the cursor.
  useEffect(() => {
    if (activeIdx >= results.length) setActiveIdx(0);
  }, [results.length, activeIdx]);

  // Keep active row in view as ↑↓ moves past the visible window. Rows
  // are nested under section wrappers, so we query the flat row list.
  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const rows = container.querySelectorAll<HTMLElement>('.launcher-row');
    const row = rows[activeIdx];
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  // Icon loading via getFileIcon is currently disabled — it has been
  // observed to crash main on certain bundles. Letter avatars below.

  const dispatch = useCallback((action: LauncherAction) => {
    void window.markoLauncher.dispatch(action);
  }, []);

  const runResult = useCallback(
    (r: Result) => {
      if (r.kind === 'command') {
        dispatch(r.cmd.action);
      } else if (r.kind === 'app') {
        dispatch({ type: 'open-app', appPath: r.app.path });
      } else if (r.kind === 'web-search') {
        dispatch({ type: 'web-search', query: r.query });
      } else {
        // Calculator: copy the result to clipboard and hide the launcher.
        // Doesn't wake main — purely a launcher-resident feature.
        void navigator.clipboard.writeText(formatCalcResult(r.result));
        void window.markoLauncher.hide();
      }
    },
    [dispatch],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void window.markoLauncher.hide();
    } else if (e.key === 'ArrowDown') {
      if (results.length === 0) return;
      e.preventDefault();
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      if (results.length === 0) return;
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      const r = results[activeIdx];
      if (!r) return;
      e.preventDefault();
      runResult(r);
    } else if (e.key === 'Tab') {
      const r = results[activeIdx];
      if (!r) return;
      e.preventDefault();
      if (r.kind === 'command') setQuery(r.cmd.keywords[0]);
      else if (r.kind === 'app') setQuery(r.app.name);
      // web-search & calculator: nothing meaningful to extend to.
    }
  };

  return (
    <div className="launcher">
      <CustomCursor />
      <LauncherInput
        ref={inputRef}
        value={query}
        placeholder="Run a command or open an app…"
        onChange={setQuery}
        onKeyDown={onKeyDown}
      />
      <div className="launcher-results" ref={resultsRef}>
        {results.length === 0 ? (
          <div className="launcher-empty">No matches.</div>
        ) : (
          (() => {
            // Render results in named sections (Raycast-style). Active
            // index is still tracked in flat-array space — we accumulate
            // a running index as we render each section.
            const sections: { label: string; items: Result[] }[] = [
              { label: 'Calculator', items: results.filter((r) => r.kind === 'calculator') },
              { label: 'Commands', items: results.filter((r) => r.kind === 'command') },
              { label: 'Applications', items: results.filter((r) => r.kind === 'app') },
              { label: 'Search', items: results.filter((r) => r.kind === 'web-search') },
            ].filter((s) => s.items.length > 0);
            let flat = 0;
            return sections.map((section) => (
              <div key={section.label} className="launcher-section">
                <div className="launcher-section-label">{section.label}</div>
                {section.items.map((r) => {
                  const i = flat++;
                  const key =
                    r.kind === 'command'
                      ? `cmd:${r.cmd.keywords[0]}`
                      : r.kind === 'app'
                        ? `app:${r.app.path}`
                        : r.kind === 'web-search'
                          ? `search:${r.query}`
                          : `calc:${r.expression}`;
                  return (
                    <ResultRow
                      key={key}
                      result={r}
                      active={i === activeIdx}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => runResult(r)}
                    />
                  );
                })}
              </div>
            ));
          })()
        )}
      </div>
      <div className="launcher-footer">
        <span><kbd>↵</kbd> run</span>
        <span><kbd>↑↓</kbd> select</span>
        <span><kbd>Tab</kbd> extend</span>
        <span><kbd>esc</kbd> hide</span>
      </div>
    </div>
  );
}
