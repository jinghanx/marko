import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace, getActiveSession } from '../state/workspace';
import type {
  GitStatusInfo,
  GitFileEntry,
  GitBranchInfo,
  GitStashEntry,
} from '../types/marko';
import {
  parseUnifiedDiff,
  buildHunkPatch,
  buildLineSelectionPatch,
  type DiffHunk,
} from '../lib/diffHunks';

const REFRESH_MS = 2500;

/** Synthesize a unified diff for an untracked file (everything is added).
 *  Matches the format git uses for new-file diffs so the existing parser and
 *  hunk-action codepaths work without a special case. */
function buildUntrackedDiff(relPath: string, content: string): string {
  const lines = content.split('\n');
  // A trailing newline produces a final empty string from split — drop it so
  // we don't render a phantom blank line and the line count is correct.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const n = lines.length;
  const head = [
    `diff --git a/${relPath} b/${relPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${relPath}`,
    `@@ -0,0 +1,${n} @@`,
  ];
  return head.join('\n') + '\n' + lines.map((l) => '+' + l).join('\n') + '\n';
}

interface SelectedFile {
  path: string;
  staged: boolean;
  /** True when the file is untracked. Captured at selection time so the diff
   *  loader can decide between calling `git diff` and synthesizing a new-file
   *  patch — without depending on the live `status` (which would flash the
   *  diff on every poll). */
  isUntracked: boolean;
}

/** Git status / stage / commit pane. Operates on the active session's
 *  rootDir; polls every few seconds and refreshes after every action so the
 *  list stays current with external changes (CLI commits, branch switches). */
export function GitView() {
  const rootDir = useWorkspace((s) => getActiveSession(s).rootDir);

  const [status, setStatus] = useState<GitStatusInfo | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo | null>(null);
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [showBranches, setShowBranches] = useState(false);
  const [showStashes, setShowStashes] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [branchMenu, setBranchMenu] = useState<string | null>(null);
  const [stashMenu, setStashMenu] = useState<string | null>(null);
  const [tagMenu, setTagMenu] = useState<string | null>(null);
  const [view, setView] = useState<'status' | 'history'>('status');
  const [tags, setTags] = useState<string[]>([]);
  const [log, setLog] = useState<import('../types/marko').GitLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [commitDiff, setCommitDiff] = useState<string | null>(null);
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);
  /** Per-hunk selected line indices for line-level staging. Keyed by hunk
   *  index in the *current* parsed diff. Cleared when selection changes. */
  const [hunkSelection, setHunkSelection] = useState<Map<number, Set<number>>>(new Map());
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped after every action (stage/unstage/discard/commit) so the diff
   *  pane refreshes — the periodic status poll deliberately does *not* bump
   *  this, otherwise the diff would flash every few seconds. */
  const [diffVersion, setDiffVersion] = useState(0);

  const refresh = useCallback(async () => {
    if (!rootDir) {
      setStatus(null);
      setBranches(null);
      setStashes([]);
      return;
    }
    try {
      const [s, b, st, tg] = await Promise.all([
        window.marko.gitStatus(rootDir),
        window.marko.gitBranches(rootDir),
        window.marko.gitStashList(rootDir),
        window.marko.gitTags(rootDir),
      ]);
      setStatus(s);
      if (b.ok && b.data) setBranches(b.data);
      if (st.ok && st.items) setStashes(st.items);
      if (tg.ok && tg.tags) setTags(tg.tags);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [rootDir]);

  /** Load the commit log when the History view is active (or after an action). */
  const refreshLog = useCallback(async () => {
    if (!rootDir) return;
    setLogLoading(true);
    try {
      const r = await window.marko.gitLog(rootDir, { limit: 200 });
      if (r.ok && r.commits) setLog(r.commits);
      else if (r.error) setError(r.error);
    } finally {
      setLogLoading(false);
    }
  }, [rootDir]);

  useEffect(() => {
    if (view === 'history') void refreshLog();
  }, [view, refreshLog]);

  // Load full commit diff when a commit is selected.
  useEffect(() => {
    if (!rootDir || !selectedCommit) {
      setCommitDiff(null);
      return;
    }
    setCommitDiffLoading(true);
    window.marko
      .gitShow(rootDir, selectedCommit)
      .then((r) => {
        if (r.ok) setCommitDiff(r.diff ?? '');
        else setError(r.error ?? 'show failed');
      })
      .finally(() => setCommitDiffLoading(false));
  }, [rootDir, selectedCommit]);

  // Reset hunk-line selection whenever the selected file or its diff changes.
  useEffect(() => {
    setHunkSelection(new Map());
  }, [selected, diff]);

  // Initial load + polling.
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Load diff when the selected file changes.
  const lastDiffKey = useRef<string | null>(null);
  useEffect(() => {
    if (!rootDir || !selected) {
      setDiff(null);
      lastDiffKey.current = null;
      return;
    }
    const key = `${selected.staged ? 'S' : 'W'}:${selected.path}`;
    lastDiffKey.current = key;
    setDiffLoading(true);

    // Untracked files have no diff — git diff doesn't include them. Synthesize
    // an "all-added" diff from the file content so the user can see what
    // they'd be staging. The patch format matches `git diff --no-index`'s
    // output for new files, so hunk staging via `git apply --cached` works.
    type DiffResult = { ok: boolean; diff?: string; error?: string };
    const loader: Promise<DiffResult> = selected.isUntracked
      ? window.marko
          .readFile(`${rootDir}/${selected.path}`)
          .then((content): DiffResult => ({
            ok: true,
            diff: buildUntrackedDiff(selected.path, content),
          }))
          .catch((e: Error): DiffResult => ({ ok: false, error: e.message }))
      : window.marko.gitDiff(rootDir, selected.path, selected.staged);

    Promise.resolve(loader)
      .then((r) => {
        if (lastDiffKey.current !== key) return;
        setDiff(r.ok ? r.diff ?? '' : null);
        if (!r.ok) setError(r.error ?? 'diff failed');
      })
      .finally(() => {
        if (lastDiffKey.current === key) setDiffLoading(false);
      });
  }, [selected, rootDir, diffVersion]);

  // After a stage/unstage/commit, refresh both the file list and the diff
  // for the still-selected file. We bump diffVersion explicitly here so the
  // periodic status poll doesn't also refetch the diff (which would flash).
  const runAction = useCallback(
    async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        if (!r.ok) setError(r.error ?? `${label} failed`);
      } finally {
        setBusy(false);
        await refresh();
        setDiffVersion((v) => v + 1);
      }
    },
    [refresh],
  );

  const stage = (paths: string[]) =>
    rootDir && runAction('stage', () => window.marko.gitStage(rootDir, paths));
  const unstage = (paths: string[]) =>
    rootDir && runAction('unstage', () => window.marko.gitUnstage(rootDir, paths));
  const discard = (paths: string[]) => {
    if (!rootDir) return;
    if (!window.confirm(`Discard changes to ${paths.length} file(s)? This can't be undone.`)) {
      return;
    }
    return runAction('discard', () => window.marko.gitDiscard(rootDir, paths));
  };

  /** Untracked files aren't in HEAD, so `git checkout --` can't restore them.
   *  "Discard" for untracked == move to Trash (recoverable) via the existing
   *  fs IPC. Repo paths are relative; resolve against rootDir for trash. */
  const trashUntracked = async (paths: string[]) => {
    if (!rootDir || paths.length === 0) return;
    const ok = await window.marko.confirm({
      message: `Move ${paths.length} untracked file${paths.length === 1 ? '' : 's'} to Trash?`,
      detail: paths.map((p) => `• ${p}`).join('\n'),
      confirmLabel: 'Move to Trash',
      dangerous: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      for (const p of paths) {
        const abs = `${rootDir}/${p}`;
        const r = await window.marko.trash(abs);
        if (!r.ok) {
          setError(`trash failed for ${p}: ${r.error}`);
          break;
        }
      }
    } finally {
      setBusy(false);
      await refresh();
      setDiffVersion((v) => v + 1);
    }
  };
  const commit = async () => {
    if (!rootDir) return;
    const msg = commitMsg.trim();
    if (!msg) {
      setError('Empty commit message');
      return;
    }
    await runAction('commit', () => window.marko.gitCommit(rootDir, msg));
    setCommitMsg('');
  };

  /** Stage / unstage / discard a single hunk by reassembling the parsed diff
   *  with only that hunk and piping it to `git apply`. */
  const applyHunk = async (
    hunk: DiffHunk,
    parsed: { fileHeader: string[]; hunks: DiffHunk[] },
    op: 'stage' | 'unstage' | 'discard',
  ) => {
    if (!rootDir) return;
    if (op === 'discard') {
      if (!window.confirm('Discard this hunk? This can\'t be undone.')) return;
    }
    const patch = buildHunkPatch(parsed, [hunk]);
    // stage: apply working-diff to index.
    // unstage: apply staged-diff to index in reverse.
    // discard: apply working-diff to working tree in reverse.
    const opts =
      op === 'stage'
        ? { cached: true }
        : op === 'unstage'
          ? { cached: true, reverse: true }
          : { reverse: true };
    await runAction(op, () => window.marko.gitApplyPatch(rootDir, patch, opts));
  };

  // Branch / remote / stash actions.
  const checkout = (branch: string) =>
    rootDir && runAction('checkout', () => window.marko.gitCheckout(rootDir, branch));
  const rebase = (target: string) => {
    if (!rootDir) return;
    if (!window.confirm(`Rebase ${branches?.current ?? 'HEAD'} onto ${target}?`)) return;
    return runAction('rebase', () => window.marko.gitRebase(rootDir, target));
  };
  const merge = (target: string) => {
    if (!rootDir) return;
    if (!window.confirm(`Merge ${target} into ${branches?.current ?? 'HEAD'}?`)) return;
    return runAction('merge', () => window.marko.gitMerge(rootDir, target));
  };
  const fetch = () => rootDir && runAction('fetch', () => window.marko.gitFetch(rootDir));
  const pull = () => rootDir && runAction('pull', () => window.marko.gitPull(rootDir));
  const push = () => rootDir && runAction('push', () => window.marko.gitPush(rootDir));
  const stashSave = async () => {
    if (!rootDir) return;
    const msg = window.prompt('Stash message (optional):', '');
    if (msg === null) return;
    return runAction('stash', () => window.marko.gitStashSave(rootDir, msg));
  };
  const stashApply = (ref: string) =>
    rootDir && runAction('stash apply', () => window.marko.gitStashApply(rootDir, ref));
  const stashPop = (ref: string) =>
    rootDir && runAction('stash pop', () => window.marko.gitStashPop(rootDir, ref));
  const stashDrop = (ref: string) => {
    if (!rootDir) return;
    if (!window.confirm(`Drop ${ref}?`)) return;
    return runAction('stash drop', () => window.marko.gitStashDrop(rootDir, ref));
  };

  const stashClearAll = async () => {
    if (!rootDir) return;
    const n = stashes.length;
    if (n === 0) return;
    const ok = await window.marko.confirm({
      message: `Drop all ${n} stash${n === 1 ? '' : 'es'}?`,
      detail:
        stashes.map((s) => `• ${s.message}`).join('\n') + "\n\nThis can't be undone.",
      confirmLabel: 'Drop all',
      dangerous: true,
    });
    if (!ok) return;
    return runAction('stash clear', () => window.marko.gitStashClear(rootDir));
  };

  /** "Drop other branches" — keeps the current branch plus a small set of
   *  conventional primary branches (main / master / trunk / develop / dev).
   *  Force-deletes (`-D`) so unmerged branches are removed too. */
  const PROTECTED_BRANCHES = new Set(['main', 'master', 'trunk', 'develop', 'dev']);
  const deleteOtherBranches = async () => {
    if (!rootDir || !branches) return;
    const cur = branches.current;
    const targets = branches.local.filter(
      (b) => b !== cur && !PROTECTED_BRANCHES.has(b),
    );
    if (targets.length === 0) {
      window.alert('No other branches to delete (current + main/master/develop are kept).');
      return;
    }
    const kept = [cur, ...branches.local.filter((b) => PROTECTED_BRANCHES.has(b) && b !== cur)];
    const ok = await window.marko.confirm({
      message: `Force-delete ${targets.length} branch${targets.length === 1 ? '' : 'es'}?`,
      detail:
        'Will delete:\n' +
        targets.map((b) => `• ${b}`).join('\n') +
        '\n\nKeeping:\n' +
        kept.map((b) => `• ${b}`).join('\n') +
        "\n\nThis can't be undone.",
      confirmLabel: 'Delete',
      dangerous: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      for (const b of targets) {
        const r = await window.marko.gitDeleteBranch(rootDir, b);
        if (!r.ok) {
          setError(`Failed to delete ${b}: ${r.error}`);
          break;
        }
      }
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const cherryPick = (hash: string) => {
    if (!rootDir) return;
    if (!window.confirm(`Cherry-pick ${hash.slice(0, 7)} onto ${branches?.current ?? 'HEAD'}?`)) return;
    return runAction('cherry-pick', () => window.marko.gitCherryPick(rootDir, hash)).then(() =>
      refreshLog(),
    );
  };

  const createTag = async () => {
    if (!rootDir) return;
    const name = window.prompt('Tag name:');
    if (!name) return;
    const message = window.prompt('Tag message (empty for lightweight):', '') ?? '';
    return runAction('tag', () => window.marko.gitCreateTag(rootDir, name, message));
  };

  const deleteTag = (name: string) => {
    if (!rootDir) return;
    if (!window.confirm(`Delete tag "${name}"?`)) return;
    return runAction('delete tag', () => window.marko.gitDeleteTag(rootDir, name));
  };

  /** Stage / discard / unstage the user-selected lines within a hunk. */
  const applyLineSelection = async (
    hunkIdx: number,
    parsed: { fileHeader: string[]; hunks: DiffHunk[] },
    op: 'stage' | 'unstage' | 'discard',
  ) => {
    if (!rootDir) return;
    const selectedLines = hunkSelection.get(hunkIdx);
    if (!selectedLines || selectedLines.size === 0) return;
    const patch = buildLineSelectionPatch(parsed, hunkIdx, selectedLines);
    if (!patch) return;
    if (op === 'discard' && !window.confirm("Discard selected lines? This can't be undone.")) {
      return;
    }
    const opts =
      op === 'stage'
        ? { cached: true }
        : op === 'unstage'
          ? { cached: true, reverse: true }
          : { reverse: true };
    await runAction(`${op} lines`, () => window.marko.gitApplyPatch(rootDir, patch, opts));
    setHunkSelection(new Map());
  };

  const toggleHunkLine = (hunkIdx: number, lineIdx: number) => {
    setHunkSelection((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(hunkIdx) ?? new Set<number>());
      if (set.has(lineIdx)) set.delete(lineIdx);
      else set.add(lineIdx);
      next.set(hunkIdx, set);
      return next;
    });
  };

  const addHunkLines = (hunkIdx: number, lineIndices: number[]) => {
    setHunkSelection((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(hunkIdx) ?? new Set<number>());
      for (const i of lineIndices) set.add(i);
      next.set(hunkIdx, set);
      return next;
    });
  };

  const { staged, unstaged, untracked } = useMemo(() => {
    const out = { staged: [] as GitFileEntry[], unstaged: [] as GitFileEntry[], untracked: [] as GitFileEntry[] };
    if (!status) return out;
    for (const f of status.files) {
      // simple-git uses '?' in both columns for untracked.
      if (f.index === '?' && f.workingDir === '?') {
        out.untracked.push(f);
        continue;
      }
      if (f.staged) out.staged.push(f);
      if (f.workingDir !== ' ' && f.workingDir !== '?') out.unstaged.push(f);
    }
    return out;
  }, [status]);

  if (!rootDir) {
    return (
      <div className="git-view git-view--empty">
        <div className="git-empty-title">No workspace open</div>
        <div className="git-empty-sub">Open a folder with ⌘⇧O to view its Git status.</div>
      </div>
    );
  }

  if (status && !status.isRepo) {
    return (
      <div className="git-view git-view--empty">
        <div className="git-empty-title">Not a Git repository</div>
        <div className="git-empty-sub">{rootDir}</div>
      </div>
    );
  }

  return (
    <div className="git-view">
      <div className="git-toolbar">
        <span className="git-branch">
          <BranchGlyph />
          <strong>{status?.branch ?? '—'}</strong>
          {status?.tracking && (
            <span className="git-tracking">
              {' → '}
              {status.tracking}
            </span>
          )}
          {status && (status.ahead > 0 || status.behind > 0) && (
            <span className="git-ahead-behind">
              {status.ahead > 0 && <span>↑{status.ahead}</span>}
              {status.behind > 0 && <span>↓{status.behind}</span>}
            </span>
          )}
        </span>
        <div className="git-view-toggle" role="tablist" aria-label="Git view">
          <button
            className={`git-view-btn${view === 'status' ? ' git-view-btn--active' : ''}`}
            onClick={() => setView('status')}
          >
            Status
          </button>
          <button
            className={`git-view-btn${view === 'history' ? ' git-view-btn--active' : ''}`}
            onClick={() => setView('history')}
          >
            History
          </button>
        </div>
        <div className="git-toolbar-actions">
          <button className="git-btn" onClick={() => void fetch()} disabled={busy} title="Fetch">
            Fetch
          </button>
          <button className="git-btn" onClick={() => void pull()} disabled={busy} title="Pull">
            Pull
          </button>
          <button className="git-btn" onClick={() => void push()} disabled={busy} title="Push">
            Push
          </button>
          <button
            className="git-btn"
            onClick={() => void stashSave()}
            disabled={busy}
            title="Stash current changes"
          >
            Stash
          </button>
          <button
            className="git-btn"
            onClick={() => void createTag()}
            disabled={busy}
            title="Create tag at HEAD"
          >
            Tag
          </button>
          {busy && <span className="git-busy">working…</span>}
          <button
            className="git-btn git-btn--icon"
            onClick={() => void refresh()}
            disabled={busy}
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {error && <div className="git-error">{error}</div>}

      {view === 'history' ? (
        <HistoryView
          commits={log}
          loading={logLoading}
          selectedHash={selectedCommit}
          onSelect={setSelectedCommit}
          diff={commitDiff}
          diffLoading={commitDiffLoading}
          onCherryPick={(h) => void cherryPick(h)}
        />
      ) : (
      <div className="git-body">
        <div className="git-list">
          <Section
            title="Staged"
            count={staged.length}
            files={staged}
            actionLabel="Unstage"
            onAction={() => unstage(staged.map((f) => f.path))}
            onPerFile={(f) => unstage([f.path])}
            selected={selected}
            setSelected={setSelected}
            staged
          />
          <Section
            title="Changes"
            count={unstaged.length}
            files={unstaged}
            actionLabel="Stage all"
            onAction={() => stage(unstaged.map((f) => f.path))}
            onPerFile={(f) => stage([f.path])}
            onDiscard={(f) => discard([f.path])}
            selected={selected}
            setSelected={setSelected}
            staged={false}
          />
          <Section
            title="Untracked"
            count={untracked.length}
            files={untracked}
            actionLabel="Add all"
            onAction={() => stage(untracked.map((f) => f.path))}
            onPerFile={(f) => stage([f.path])}
            onDiscard={(f) => void trashUntracked([f.path])}
            selected={selected}
            setSelected={setSelected}
            staged={false}
          />

          {staged.length === 0 && unstaged.length === 0 && untracked.length === 0 && (
            <div className="git-clean">Working tree clean</div>
          )}

          {branches && (
            <div className="git-section">
              <div
                className="git-section-header git-section-header--toggle"
                onClick={() => setShowBranches((v) => !v)}
              >
                <span className="git-section-arrow">{showBranches ? '▼' : '▶'}</span>
                <span className="git-section-title">Branches</span>
                <span className="git-section-count">
                  {branches.local.length + branches.remote.length}
                </span>
                <button
                  className="git-section-action git-section-action--danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteOtherBranches();
                  }}
                  title="Force-delete all local branches except current and main/master/develop"
                >
                  Drop others
                </button>
              </div>
              {showBranches && (
                <div className="git-section-files">
                  {branches.local.map((b) => (
                    <BranchRow
                      key={`L:${b}`}
                      name={b}
                      isCurrent={b === branches.current}
                      isRemote={false}
                      menuOpen={branchMenu === `L:${b}`}
                      onToggleMenu={() =>
                        setBranchMenu((cur) => (cur === `L:${b}` ? null : `L:${b}`))
                      }
                      onCheckout={() => {
                        setBranchMenu(null);
                        void checkout(b);
                      }}
                      onMerge={() => {
                        setBranchMenu(null);
                        void merge(b);
                      }}
                      onRebase={() => {
                        setBranchMenu(null);
                        void rebase(b);
                      }}
                    />
                  ))}
                  {branches.remote.map((b) => (
                    <BranchRow
                      key={`R:${b}`}
                      name={b}
                      isCurrent={false}
                      isRemote
                      menuOpen={branchMenu === `R:${b}`}
                      onToggleMenu={() =>
                        setBranchMenu((cur) => (cur === `R:${b}` ? null : `R:${b}`))
                      }
                      onCheckout={() => {
                        setBranchMenu(null);
                        void checkout(b);
                      }}
                      onMerge={() => {
                        setBranchMenu(null);
                        void merge(b);
                      }}
                      onRebase={() => {
                        setBranchMenu(null);
                        void rebase(b);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {stashes.length > 0 && (
            <div className="git-section">
              <div
                className="git-section-header git-section-header--toggle"
                onClick={() => setShowStashes((v) => !v)}
              >
                <span className="git-section-arrow">{showStashes ? '▼' : '▶'}</span>
                <span className="git-section-title">Stashes</span>
                <span className="git-section-count">{stashes.length}</span>
                <button
                  className="git-section-action git-section-action--danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void stashClearAll();
                  }}
                  title="Drop all stashes"
                >
                  Drop all
                </button>
              </div>
              {showStashes && (
                <div className="git-section-files">
                  {stashes.map((s) => (
                    <div key={s.ref} className="git-stash">
                      <span className="git-stash-msg" title={`${s.ref} · ${s.date}`}>
                        {s.message}
                      </span>
                      <div className="git-branch-actions">
                        <button
                          className="git-file-btn"
                          onClick={() =>
                            setStashMenu((cur) => (cur === s.ref ? null : s.ref))
                          }
                          title="Stash actions"
                        >
                          ⋯
                        </button>
                        {stashMenu === s.ref && (
                          <div
                            className="git-branch-menu"
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <button
                              className="git-branch-menu-item"
                              onClick={() => {
                                setStashMenu(null);
                                void stashApply(s.ref);
                              }}
                            >
                              Apply (keep stash)
                            </button>
                            <button
                              className="git-branch-menu-item"
                              onClick={() => {
                                setStashMenu(null);
                                void stashPop(s.ref);
                              }}
                            >
                              Pop (apply &amp; drop)
                            </button>
                            <button
                              className="git-branch-menu-item"
                              onClick={() => {
                                setStashMenu(null);
                                void stashDrop(s.ref);
                              }}
                            >
                              Drop
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tags.length > 0 && (
            <div className="git-section">
              <div
                className="git-section-header git-section-header--toggle"
                onClick={() => setShowTags((v) => !v)}
              >
                <span className="git-section-arrow">{showTags ? '▼' : '▶'}</span>
                <span className="git-section-title">Tags</span>
                <span className="git-section-count">{tags.length}</span>
              </div>
              {showTags && (
                <div className="git-section-files">
                  {tags.map((t) => (
                    <div key={t} className="git-tag-row">
                      <span className="git-tag-name" title={t}>{t}</span>
                      <div className="git-branch-actions">
                        <button
                          className="git-file-btn"
                          onClick={() =>
                            setTagMenu((cur) => (cur === t ? null : t))
                          }
                          title="Tag actions"
                        >
                          ⋯
                        </button>
                        {tagMenu === t && (
                          <div
                            className="git-branch-menu"
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <button
                              className="git-branch-menu-item"
                              onClick={() => {
                                setTagMenu(null);
                                void deleteTag(t);
                              }}
                            >
                              Delete tag
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="git-diff-pane">
          {selected ? (
            <>
              <div className="git-diff-header">
                <span className="git-diff-tag">{selected.staged ? 'STAGED' : 'WORKING'}</span>
                <span className="git-diff-path">{selected.path}</span>
              </div>
              <DiffWithHunks
                text={diff ?? ''}
                loading={diffLoading}
                staged={selected.staged}
                onApplyHunk={(hunk, parsed, op) => void applyHunk(hunk, parsed, op)}
                hunkSelection={hunkSelection}
                onToggleLine={toggleHunkLine}
                onAddLines={addHunkLines}
                onApplyLines={(hi, parsed, op) => void applyLineSelection(hi, parsed, op)}
                onClearSelection={() => setHunkSelection(new Map())}
              />
            </>
          ) : (
            <div className="git-diff-placeholder">Select a file to see its diff.</div>
          )}
        </div>
      </div>
      )}

      {view === 'status' && (
      <div className="git-commit">
        <textarea
          className="git-commit-msg"
          value={commitMsg}
          placeholder={
            staged.length > 0
              ? 'Commit message…'
              : 'Stage changes first, then write a commit message here.'
          }
          onChange={(e) => setCommitMsg(e.target.value)}
          rows={2}
          spellCheck={false}
        />
        <button
          className="git-commit-btn"
          onClick={() => void commit()}
          disabled={busy || staged.length === 0 || !commitMsg.trim()}
        >
          Commit ({staged.length})
        </button>
      </div>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  files,
  actionLabel,
  onAction,
  onPerFile,
  onDiscard,
  selected,
  setSelected,
  staged,
}: {
  title: string;
  count: number;
  files: GitFileEntry[];
  actionLabel: string;
  onAction: () => void;
  onPerFile: (f: GitFileEntry) => void;
  onDiscard?: (f: GitFileEntry) => void;
  selected: SelectedFile | null;
  setSelected: (s: SelectedFile | null) => void;
  staged: boolean;
}) {
  if (count === 0) return null;
  return (
    <div className="git-section">
      <div className="git-section-header">
        <span className="git-section-title">{title}</span>
        <span className="git-section-count">{count}</span>
        <button className="git-section-action" onClick={onAction}>
          {actionLabel}
        </button>
      </div>
      <div className="git-section-files">
        {files.map((f) => {
          const isActive =
            selected && selected.path === f.path && selected.staged === staged;
          return (
            <div
              key={`${staged ? 'S' : 'W'}:${f.path}`}
              className={`git-file${isActive ? ' git-file--active' : ''}`}
              onClick={() =>
                setSelected({
                  path: f.path,
                  staged,
                  isUntracked: f.index === '?' && f.workingDir === '?',
                })
              }
            >
              <FileStatusBadge index={f.index} workingDir={f.workingDir} staged={staged} />
              <FilePathLabel path={f.path} />
              <div className="git-file-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="git-file-btn"
                  onClick={() => onPerFile(f)}
                  title={staged ? 'Unstage' : 'Stage'}
                >
                  {staged ? '−' : '+'}
                </button>
                {onDiscard && (
                  <button
                    className="git-file-btn git-file-btn--danger"
                    onClick={() => onDiscard(f)}
                    title="Discard changes"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilePathLabel({ path }: { path: string }) {
  // Split into basename + dir so the basename is always visible. The dir is
  // shown muted, truncated from the *left* with leading "…/" so the trailing
  // segment (closest to the file) stays visible — that's the most useful
  // disambiguator when you have similarly-named files.
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash) : '';
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  return (
    <span className="git-file-label" title={path}>
      <span className="git-file-name">{name}</span>
      {dir && <span className="git-file-dir">{dir}</span>}
    </span>
  );
}

function FileStatusBadge({
  index,
  workingDir,
  staged,
}: {
  index: string;
  workingDir: string;
  staged: boolean;
}) {
  // Show the relevant column. Untracked is always '?'; renamed shows 'R'.
  const ch = staged ? index : workingDir;
  const cls =
    ch === 'M'
      ? 'git-badge--modified'
      : ch === 'A'
        ? 'git-badge--added'
        : ch === 'D'
          ? 'git-badge--deleted'
          : ch === 'R'
            ? 'git-badge--renamed'
            : ch === '?'
              ? 'git-badge--untracked'
              : 'git-badge--other';
  return <span className={`git-badge ${cls}`}>{ch === ' ' ? '·' : ch}</span>;
}

function DiffWithHunks({
  text,
  loading,
  staged,
  onApplyHunk,
  hunkSelection,
  onToggleLine,
  onAddLines,
  onApplyLines,
  onClearSelection,
}: {
  text: string;
  loading: boolean;
  staged: boolean;
  onApplyHunk: (
    hunk: DiffHunk,
    parsed: { fileHeader: string[]; hunks: DiffHunk[] },
    op: 'stage' | 'unstage' | 'discard',
  ) => void;
  hunkSelection: Map<number, Set<number>>;
  onToggleLine: (hunkIdx: number, lineIdx: number) => void;
  onAddLines: (hunkIdx: number, lineIndices: number[]) => void;
  onApplyLines: (
    hunkIdx: number,
    parsed: { fileHeader: string[]; hunks: DiffHunk[] },
    op: 'stage' | 'unstage' | 'discard',
  ) => void;
  onClearSelection: () => void;
}) {
  const parsed = useMemo(() => parseUnifiedDiff(text), [text]);
  /** Anchor for shift-click range selection. Updated on every plain click;
   *  reset when the parent clears the selection (effect below). */
  const [anchor, setAnchor] = useState<{ hunkIdx: number; lineIdx: number } | null>(null);
  useEffect(() => {
    let any = false;
    for (const set of hunkSelection.values()) {
      if (set.size > 0) {
        any = true;
        break;
      }
    }
    if (!any) setAnchor(null);
  }, [hunkSelection]);

  if (loading) return <div className="git-diff-loading">Loading…</div>;
  if (!text || !parsed) return <div className="git-diff-loading">No changes</div>;

  const handleLineClick = (e: React.MouseEvent, hi: number, li: number) => {
    if (e.shiftKey && anchor && anchor.hunkIdx === hi) {
      const [lo, hi2] =
        anchor.lineIdx <= li ? [anchor.lineIdx, li] : [li, anchor.lineIdx];
      const hunk = parsed.hunks[hi];
      const toAdd: number[] = [];
      for (let idx = lo; idx <= hi2; idx++) {
        const line = hunk.body[idx];
        if (line && (line.startsWith('+') || line.startsWith('-'))) toAdd.push(idx);
      }
      if (toAdd.length > 0) onAddLines(hi, toAdd);
    } else {
      onToggleLine(hi, li);
      setAnchor({ hunkIdx: hi, lineIdx: li });
    }
  };

  /** Click outside any line/hunk-action area clears the line selection. We
   *  detect "clickable click target" by checking ancestry against
   *  `.git-diff-line--clickable` and `.git-hunk-actions` so the line-toggle
   *  handlers (which let the event bubble) don't accidentally deselect. */
  const onContainerClick = (e: React.MouseEvent) => {
    const t = e.target as Element;
    if (t.closest('.git-diff-line--clickable, .git-hunk-actions')) return;
    let any = false;
    for (const set of hunkSelection.values()) {
      if (set.size > 0) {
        any = true;
        break;
      }
    }
    if (any) onClearSelection();
  };

  return (
    <div className="git-diff-pre" onClick={onContainerClick}>
      {parsed.fileHeader.map((line, i) => (
        <div key={`h-${i}`} className="git-diff-line git-diff-line--meta">
          {line || ' '}
        </div>
      ))}
      {parsed.hunks.map((hunk, hi) => {
        const selectedLines = hunkSelection.get(hi);
        const hasLineSelection = !!selectedLines && selectedLines.size > 0;
        return (
          <div key={hi} className="git-hunk">
            <div className="git-hunk-header-row">
              <span className="git-diff-line git-diff-line--hunk git-hunk-header">
                {hunk.header}
              </span>
              <div className="git-hunk-actions">
                {hasLineSelection ? (
                  staged ? (
                    <button
                      className="git-hunk-btn"
                      onClick={() => onApplyLines(hi, parsed, 'unstage')}
                      title={`Unstage ${selectedLines!.size} line(s)`}
                    >
                      Unstage {selectedLines!.size} line(s)
                    </button>
                  ) : (
                    <>
                      <button
                        className="git-hunk-btn"
                        onClick={() => onApplyLines(hi, parsed, 'stage')}
                        title={`Stage ${selectedLines!.size} line(s)`}
                      >
                        Stage {selectedLines!.size} line(s)
                      </button>
                      <button
                        className="git-hunk-btn git-hunk-btn--danger"
                        onClick={() => onApplyLines(hi, parsed, 'discard')}
                        title={`Discard ${selectedLines!.size} line(s)`}
                      >
                        Discard {selectedLines!.size}
                      </button>
                    </>
                  )
                ) : staged ? (
                  <button
                    className="git-hunk-btn"
                    onClick={() => onApplyHunk(hunk, parsed, 'unstage')}
                    title="Unstage hunk"
                  >
                    Unstage hunk
                  </button>
                ) : (
                  <>
                    <button
                      className="git-hunk-btn"
                      onClick={() => onApplyHunk(hunk, parsed, 'stage')}
                      title="Stage hunk"
                    >
                      Stage hunk
                    </button>
                    <button
                      className="git-hunk-btn git-hunk-btn--danger"
                      onClick={() => onApplyHunk(hunk, parsed, 'discard')}
                      title="Discard hunk"
                    >
                      Discard
                    </button>
                  </>
                )}
              </div>
            </div>
            {hunk.body.map((line, li) => {
              const isChange = line.startsWith('+') || line.startsWith('-');
              const isSel = !!selectedLines && selectedLines.has(li);
              let cls = 'git-diff-line';
              if (line.startsWith('+')) cls += ' git-diff-line--added';
              else if (line.startsWith('-')) cls += ' git-diff-line--removed';
              if (isChange) cls += ' git-diff-line--clickable';
              if (isSel) cls += ' git-diff-line--selected';
              return (
                <div
                  key={li}
                  className={cls}
                  onClick={isChange ? (e) => handleLineClick(e, hi, li) : undefined}
                >
                  {line || ' '}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function BranchRow({
  name,
  isCurrent,
  isRemote,
  menuOpen,
  onToggleMenu,
  onCheckout,
  onMerge,
  onRebase,
}: {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCheckout: () => void;
  onMerge: () => void;
  onRebase: () => void;
}) {
  return (
    <div className={`git-branch-row${isCurrent ? ' git-branch-row--current' : ''}`}>
      <span className="git-branch-marker">{isCurrent ? '●' : isRemote ? '↗' : '○'}</span>
      <span className="git-branch-name" title={name}>
        {name}
      </span>
      {!isCurrent && (
        <div className="git-branch-actions">
          <button className="git-file-btn" onClick={onToggleMenu} title="Branch actions">
            ⋯
          </button>
          {menuOpen && (
            <div className="git-branch-menu" onMouseDown={(e) => e.stopPropagation()}>
              <button className="git-branch-menu-item" onClick={onCheckout}>
                Checkout
              </button>
              <button className="git-branch-menu-item" onClick={onMerge}>
                Merge into current
              </button>
              <button className="git-branch-menu-item" onClick={onRebase}>
                Rebase current onto this
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function BranchGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={13} height={13} aria-hidden fill="none">
      <circle cx="4" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="4" cy="12.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4 5.5 V11 M4 7 q0 4 8 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function HistoryView({
  commits,
  loading,
  selectedHash,
  onSelect,
  diff,
  diffLoading,
  onCherryPick,
}: {
  commits: import('../types/marko').GitLogEntry[];
  loading: boolean;
  selectedHash: string | null;
  onSelect: (h: string) => void;
  diff: string | null;
  diffLoading: boolean;
  onCherryPick: (h: string) => void;
}) {
  return (
    <div className="git-body">
      <div className="git-list git-history-list">
        {loading && commits.length === 0 && (
          <div className="git-clean">Loading history…</div>
        )}
        {!loading && commits.length === 0 && (
          <div className="git-clean">No commits.</div>
        )}
        {commits.map((c) => {
          const date = c.date ? new Date(c.date) : null;
          const dateLabel = date ? formatRelative(date) : '';
          const active = c.hash === selectedHash;
          return (
            <div
              key={c.hash}
              className={`git-commit-row${active ? ' git-commit-row--active' : ''}`}
              onClick={() => onSelect(c.hash)}
            >
              <div className="git-commit-row-line1">
                <span className="git-commit-hash">{c.shortHash}</span>
                <span className="git-commit-subject" title={c.subject}>
                  {c.subject}
                </span>
              </div>
              <div className="git-commit-row-line2">
                <span className="git-commit-author">{c.author}</span>
                <span className="git-commit-date">{dateLabel}</span>
              </div>
              {active && (
                <div
                  className="git-commit-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="git-hunk-btn"
                    onClick={() => onCherryPick(c.hash)}
                    title="Cherry-pick this commit onto current branch"
                  >
                    Cherry-pick
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="git-diff-pane">
        {selectedHash ? (
          <>
            <div className="git-diff-header">
              <span className="git-diff-tag">COMMIT</span>
              <span className="git-diff-path">{selectedHash.slice(0, 12)}</span>
            </div>
            {diffLoading ? (
              <div className="git-diff-loading">Loading…</div>
            ) : (
              <CommitDiffPre text={diff ?? ''} />
            )}
          </>
        ) : (
          <div className="git-diff-placeholder">Select a commit to see its diff.</div>
        )}
      </div>
    </div>
  );
}

function CommitDiffPre({ text }: { text: string }) {
  if (!text) return <div className="git-diff-loading">No diff</div>;
  // Light-touch coloring per line — commits are read-only here so we don't
  // need the full hunk-action UI.
  const lines = text.split('\n');
  return (
    <div className="git-diff-pre">
      {lines.map((line, i) => {
        let cls = 'git-diff-line';
        if (line.startsWith('+++') || line.startsWith('---')) cls += ' git-diff-line--meta';
        else if (line.startsWith('@@')) cls += ' git-diff-line--hunk';
        else if (line.startsWith('+')) cls += ' git-diff-line--added';
        else if (line.startsWith('-')) cls += ' git-diff-line--removed';
        else if (
          line.startsWith('diff ') ||
          line.startsWith('index ') ||
          line.startsWith('commit ') ||
          line.startsWith('Author:') ||
          line.startsWith('Date:')
        ) {
          cls += ' git-diff-line--meta';
        }
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        );
      })}
    </div>
  );
}

function formatRelative(date: Date): string {
  const now = Date.now();
  const ms = now - date.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 14) return `${days}d ago`;
  return date.toLocaleDateString();
}
