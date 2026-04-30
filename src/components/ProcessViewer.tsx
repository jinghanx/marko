import { useEffect, useMemo, useRef, useState } from 'react';
import { Fzf, type FzfResultItem } from 'fzf';
import type { ProcInfo, SystemStats } from '../types/marko';

type SortKey = 'cpu' | 'mem' | 'pid' | 'rss' | 'time' | 'command';

const REFRESH_MS = 1500;
const MAX_RESULTS = 500;

/** Lives as a tab kind ('process'). Polls system stats every REFRESH_MS while
 *  mounted; React unmounts when the user closes the tab, which cancels the
 *  interval automatically. */
export function ProcessViewer() {
  const [procs, setProcs] = useState<ProcInfo[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [query, setQuery] = useState('');
  const [activePid, setActivePid] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('cpu');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const [list, sys] = await Promise.all([
          window.marko.listProcesses(),
          window.marko.systemStats(),
        ]);
        if (!cancelled) {
          setProcs(list);
          setStats(sys);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let tries = 0;
    const tryFocus = () => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      if (document.activeElement !== el && tries++ < 6) setTimeout(tryFocus, 30);
    };
    requestAnimationFrame(tryFocus);
  }, []);

  const fzf = useMemo(() => {
    if (procs.length === 0) return null;
    return new Fzf(procs, {
      selector: (p) => `${p.command} ${p.args} ${p.user}`,
      limit: MAX_RESULTS,
    });
  }, [procs]);

  const sorted = useMemo(() => {
    const copy = [...procs];
    const cmp = (a: ProcInfo, b: ProcInfo) => {
      if (sortKey === 'cpu') return b.cpu - a.cpu;
      if (sortKey === 'mem') return b.mem - a.mem;
      if (sortKey === 'rss') return b.rss - a.rss;
      if (sortKey === 'pid') return a.pid - b.pid;
      if (sortKey === 'time') return parseTime(b.time) - parseTime(a.time);
      return a.command.localeCompare(b.command);
    };
    copy.sort(cmp);
    return copy;
  }, [procs, sortKey]);

  const results: FzfResultItem<ProcInfo>[] = useMemo(() => {
    if (!query) {
      return sorted.slice(0, MAX_RESULTS).map(
        (p) =>
          ({
            item: p,
            positions: new Set<number>(),
            start: 0,
            end: 0,
            score: 0,
          } as FzfResultItem<ProcInfo>),
      );
    }
    if (!fzf) return [];
    const matched = fzf.find(query);
    return matched.sort((a, b) => {
      if (sortKey === 'cpu') return b.item.cpu - a.item.cpu;
      if (sortKey === 'mem') return b.item.mem - a.item.mem;
      if (sortKey === 'rss') return b.item.rss - a.item.rss;
      if (sortKey === 'pid') return a.item.pid - b.item.pid;
      if (sortKey === 'time') return parseTime(b.item.time) - parseTime(a.item.time);
      return b.score - a.score;
    });
  }, [fzf, sorted, query, sortKey]);

  // Resolve the active row from the PID. If the PID is gone, fall back to the
  // first row so the user is never stranded on an empty selection.
  const activeIndex = useMemo(() => {
    if (results.length === 0) return -1;
    if (activePid != null) {
      const idx = results.findIndex((r) => r.item.pid === activePid);
      if (idx >= 0) return idx;
    }
    return 0;
  }, [results, activePid]);

  // Initialize activePid the first time results land.
  useEffect(() => {
    if (activePid == null && results.length > 0) {
      setActivePid(results[0].item.pid);
    }
  }, [results, activePid]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const moveBy = (delta: number) => {
    if (results.length === 0) return;
    const cur = activeIndex < 0 ? 0 : activeIndex;
    const next = Math.max(0, Math.min(results.length - 1, cur + delta));
    setActivePid(results[next].item.pid);
  };

  const killActive = async () => {
    const proc = activeIndex >= 0 ? results[activeIndex]?.item : undefined;
    if (!proc) return;
    const ok = window.confirm(`Send SIGTERM to ${proc.command} (PID ${proc.pid})?`);
    if (!ok) return;
    const result = await window.marko.killProcess(proc.pid, 'SIGTERM');
    if (!result.ok) setError(result.error ?? 'kill failed');
    else {
      try {
        setProcs(await window.marko.listProcesses());
      } catch {
        // ignore
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      moveBy(1);
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      moveBy(-1);
    } else if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void killActive();
    }
  };

  const taskCount = procs.length;
  const runningCount = procs.filter((p) => p.state.startsWith('R')).length;

  return (
    <div className="procviewer-pane">
      <div className="procviewer">
        {stats && (
          <SystemSummary
            stats={stats}
            taskCount={taskCount}
            runningCount={runningCount}
          />
        )}

        <input
          ref={inputRef}
          className="palette-input procviewer-input"
          value={query}
          placeholder="Filter processes (fuzzy)…"
          onChange={(e) => {
            setQuery(e.target.value);
            // Reset selection to the first match of the new query.
            setActivePid(null);
          }}
          onKeyDown={onKeyDown}
        />

        <div className="proc-header">
          <SortBtn label="PID" k="pid" cur={sortKey} set={setSortKey} />
          <SortBtn label="USER" k="command" cur={sortKey} set={setSortKey} />
          <SortBtn label="VIRT" k="rss" cur={sortKey} set={setSortKey} />
          <SortBtn label="RES" k="rss" cur={sortKey} set={setSortKey} />
          <span className="proc-col-s">S</span>
          <SortBtn label="CPU%" k="cpu" cur={sortKey} set={setSortKey} />
          <SortBtn label="MEM%" k="mem" cur={sortKey} set={setSortKey} />
          <SortBtn label="TIME+" k="time" cur={sortKey} set={setSortKey} />
          <SortBtn label="COMMAND" k="command" cur={sortKey} set={setSortKey} />
        </div>

        <div className="palette-results proc-list" ref={listRef}>
          {error && <div className="palette-empty">Error: {error}</div>}
          {!error && results.length === 0 && <div className="palette-empty">No matches.</div>}
          {results.map((r, i) => (
            <ProcRow
              key={r.item.pid}
              proc={r.item}
              positions={r.positions}
              index={i}
              active={i === activeIndex}
              onMouseEnter={() => setActivePid(r.item.pid)}
            />
          ))}
        </div>

        <div className="proc-fkeys">
          <FKey n="↑↓" label="Nav" />
          <FKey n="⌘K" label="Kill" />
          <span className="palette-count">{taskCount} tasks</span>
        </div>
      </div>
    </div>
  );
}

// ---------- Subcomponents ----------

function SystemSummary({
  stats,
  taskCount,
  runningCount,
}: {
  stats: SystemStats;
  taskCount: number;
  runningCount: number;
}) {
  const memPct = stats.memTotal > 0 ? stats.memUsed / stats.memTotal : 0;
  const cores = stats.cpus.length;
  // Two columns of CPU bars to keep the header compact.
  const cols = cores >= 8 ? 2 : 1;
  const perCol = Math.ceil(cores / cols);

  return (
    <div className="proc-summary">
      <div className="proc-summary-cpus" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: cols }).map((_, c) => (
          <div className="proc-summary-cpucol" key={c}>
            {stats.cpus.slice(c * perCol, (c + 1) * perCol).map((u, i) => (
              <Bar key={i} label={`${c * perCol + i}`} value={u} mode="cpu" />
            ))}
          </div>
        ))}
      </div>
      <div className="proc-summary-bars">
        <Bar
          label="Mem"
          value={memPct}
          mode="mem"
          right={`${formatBytes(stats.memUsed)}/${formatBytes(stats.memTotal)}`}
        />
      </div>
      <div className="proc-summary-meta">
        <span>
          Tasks: <strong>{taskCount}</strong>; <strong>{runningCount}</strong> running
        </span>
        <span>
          Load: <strong>{stats.loadavg[0].toFixed(2)}</strong>{' '}
          {stats.loadavg[1].toFixed(2)} {stats.loadavg[2].toFixed(2)}
        </span>
        <span>Up: {formatUptime(stats.uptime)}</span>
      </div>
    </div>
  );
}

function Bar({
  label,
  value,
  mode,
  right,
  width = 22,
}: {
  label: string;
  value: number;
  mode: 'cpu' | 'mem';
  right?: string;
  width?: number;
}) {
  const pct = Math.max(0, Math.min(1, value));
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const colorCls =
    pct < 0.5 ? 'tbar-fill--low' : pct < 0.85 ? 'tbar-fill--med' : 'tbar-fill--high';
  return (
    <div className={`tbar tbar--${mode}`}>
      <span className="tbar-label">{label}</span>
      <span className="tbar-bracket">[</span>
      <span className={`tbar-fill ${colorCls}`}>{'|'.repeat(filled)}</span>
      <span className="tbar-empty">{' '.repeat(empty)}</span>
      <span className="tbar-bracket">]</span>
      <span className="tbar-value">{right ?? `${(pct * 100).toFixed(1)}%`}</span>
    </div>
  );
}

function SortBtn({
  label,
  k,
  cur,
  set,
}: {
  label: string;
  k: SortKey;
  cur: SortKey;
  set: (k: SortKey) => void;
}) {
  return (
    <button className={`proc-sort ${cur === k ? 'proc-sort--active' : ''}`} onClick={() => set(k)}>
      {label}
      {cur === k && <span className="proc-sort-arrow">▼</span>}
    </button>
  );
}

function ProcRow({
  proc,
  positions,
  index,
  active,
  onMouseEnter,
}: {
  proc: ProcInfo;
  positions: Set<number>;
  index: number;
  active: boolean;
  onMouseEnter: () => void;
}) {
  return (
    <div
      data-index={index}
      className={`proc-row ${active ? 'proc-row--active' : ''}`}
      onMouseEnter={onMouseEnter}
    >
      <span className="proc-pid">{proc.pid}</span>
      <span className="proc-user" title={proc.user}>
        {proc.user}
      </span>
      <span className="proc-virt">{formatKb(proc.vsz)}</span>
      <span className="proc-res">{formatKb(proc.rss)}</span>
      <span className={`proc-state proc-state--${proc.state[0] ?? 'S'}`}>{proc.state}</span>
      <span className="proc-cpu">{proc.cpu.toFixed(1)}</span>
      <span className="proc-mem">{proc.mem.toFixed(1)}</span>
      <span className="proc-time">{proc.time}</span>
      <span className="proc-cmd">
        <span className="proc-cmd-name">{highlight(proc.command, positions, 0)}</span>
        <span className="proc-cmd-args">{proc.args}</span>
      </span>
    </div>
  );
}

function FKey({ n, label }: { n: string; label: string }) {
  return (
    <span className="proc-fkey">
      <kbd>{n}</kbd>
      <span>{label}</span>
    </span>
  );
}

// ---------- Helpers ----------

function highlight(text: string, positions: Set<number>, offset: number) {
  if (!positions.size) return text;
  const out: React.ReactNode[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    if (positions.has(i + offset)) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      out.push(
        <span key={i} className="palette-match">
          {text[i]}
        </span>,
      );
    } else {
      buf += text[i];
    }
  }
  if (buf) out.push(buf);
  return out;
}

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}G`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)}M`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}K`;
  return `${n}`;
}

function formatKb(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)}G`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)}M`;
  return `${kb}K`;
}

function formatUptime(s: number): string {
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function parseTime(t: string): number {
  // ps `time` format on macOS: M:SS.SS or H:MM:SS.SS
  const parts = t.split(':');
  if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  if (parts.length === 3)
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
  return parseFloat(t) || 0;
}
