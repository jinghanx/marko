import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace, getActiveSession } from '../state/workspace';
import type {
  GitStatusInfo,
  GitFileEntry,
  GitBranchInfo,
  GitStashEntry,
  GhPr,
  GhIssue,
  GhRun,
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
  /** Multi-select set keyed by `${section}:${path}` — `S` for staged,
   *  `W` for working/untracked. Cmd-click toggles, shift-click selects
   *  a range from the last single-clicked row. Right-click opens a
   *  menu that operates on this whole set if non-empty. */
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [lastClickedKey, setLastClickedKey] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | { x: number; y: number; targetKey: string; targetPath: string; targetStaged: boolean }
    | null
  >(null);
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

  // ---------- GitHub-aware extras (RepoBar parity) ----------
  // owner/repo + web URL when the origin remote is on github.com.
  // Used by the "Open on GitHub" actions and to gate the gh CLI calls
  // (no point asking gh about a non-GitHub repo).
  const [githubInfo, setGithubInfo] = useState<{ owner: string; repo: string; web: string } | null>(null);
  // gh CLI capability — null while probing.
  const [ghStatus, setGhStatus] = useState<{ available: boolean; authed: boolean } | null>(null);
  const [prs, setPrs] = useState<GhPr[] | null>(null);
  const [issues, setIssues] = useState<GhIssue[] | null>(null);
  const [latestRun, setLatestRun] = useState<GhRun | null>(null);
  const [showGhDetails, setShowGhDetails] = useState(false);
  const [changelog, setChangelog] = useState<{ heading: string; body: string; filename: string } | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);

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

  // GitHub remote + CHANGELOG: probed once per rootDir change. The gh
  // CLI capability check is a separate useEffect because it doesn't
  // depend on rootDir (it's machine-wide).
  useEffect(() => {
    if (!rootDir) {
      setGithubInfo(null);
      setChangelog(null);
      return;
    }
    let cancelled = false;
    void window.marko.gitGithubRemote(rootDir).then((r) => {
      if (cancelled) return;
      setGithubInfo(r.ok && r.owner && r.repo && r.web ? { owner: r.owner, repo: r.repo, web: r.web } : null);
    });
    void window.marko.gitChangelogTop(rootDir).then((r) => {
      if (cancelled) return;
      setChangelog(r.ok && r.heading && r.filename ? { heading: r.heading, body: r.body ?? '', filename: r.filename } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [rootDir]);

  useEffect(() => {
    let cancelled = false;
    void window.marko.ghCheck().then((r) => {
      if (cancelled) return;
      setGhStatus({ available: r.available, authed: r.authed });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pull PRs / issues / latest run only when the cheap preconditions
  // line up (GitHub remote AND gh authed). Branch-scoped run is keyed
  // off the current branch so it refreshes when the user switches.
  const currentBranch = status?.branch ?? null;
  useEffect(() => {
    if (!rootDir || !githubInfo || !ghStatus?.authed) {
      setPrs(null);
      setIssues(null);
      setLatestRun(null);
      return;
    }
    let cancelled = false;
    void window.marko.ghPrList(rootDir).then((r) => {
      if (!cancelled && r.ok) setPrs(r.prs ?? []);
    });
    void window.marko.ghIssueList(rootDir).then((r) => {
      if (!cancelled && r.ok) setIssues(r.issues ?? []);
    });
    if (currentBranch) {
      void window.marko.ghRunLatest(rootDir, currentBranch).then((r) => {
        if (!cancelled && r.ok) setLatestRun(r.run ?? null);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [rootDir, githubInfo, ghStatus?.authed, currentBranch]);

  const openExt = useCallback((url: string) => {
    void window.marko.shellOpenExternal(url);
  }, []);

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

  /** Flat ordered list of every visible row across the three sections,
   *  so shift-click range selection can resolve "from / to" anywhere in
   *  the list. Order matches the rendered DOM: staged → unstaged →
   *  untracked. */
  const allRows = useMemo(() => {
    const rows: { key: string; path: string; staged: boolean; isUntracked: boolean }[] = [];
    for (const f of staged) {
      rows.push({ key: `S:${f.path}`, path: f.path, staged: true, isUntracked: false });
    }
    for (const f of unstaged) {
      rows.push({ key: `W:${f.path}`, path: f.path, staged: false, isUntracked: false });
    }
    for (const f of untracked) {
      rows.push({ key: `W:${f.path}`, path: f.path, staged: false, isUntracked: true });
    }
    return rows;
  }, [staged, unstaged, untracked]);

  /** Clear stale entries from multiSelected when the file list changes
   *  (after stage / unstage / commit etc.) — otherwise dead keys stick
   *  around and re-select the wrong rows on next refresh. */
  useEffect(() => {
    const live = new Set(allRows.map((r) => r.key));
    setMultiSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (live.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [allRows]);

  // Close the context menu on any outside click or keypress.
  useEffect(() => {
    if (!contextMenu) return;
    const onMouse = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('.ctx-menu')) return;
      setContextMenu(null);
    };
    const onKey = () => setContextMenu(null);
    document.addEventListener('mousedown', onMouse, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onMouse, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [contextMenu]);

  const handleRowMouseDown = (
    key: string,
    path: string,
    isStaged: boolean,
    isUntracked: boolean,
  ) => (e: React.MouseEvent) => {
    // Right-click is reserved for opening the context menu — onContextMenu
    // handles selection-aware logic separately.
    if (e.button !== 0) return;
    if (e.shiftKey && lastClickedKey) {
      e.preventDefault();
      const startIdx = allRows.findIndex((r) => r.key === lastClickedKey);
      const endIdx = allRows.findIndex((r) => r.key === key);
      if (startIdx >= 0 && endIdx >= 0) {
        const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        setMultiSelected(new Set(allRows.slice(lo, hi + 1).map((r) => r.key)));
      }
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      setMultiSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setLastClickedKey(key);
      return;
    }
    // Plain click: clear multi-selection, select just this row, and
    // surface it in the diff pane.
    setMultiSelected(new Set([key]));
    setLastClickedKey(key);
    setSelected({ path, staged: isStaged, isUntracked });
  };

  const handleRowContextMenu = (
    key: string,
    path: string,
    isStaged: boolean,
  ) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // If the right-clicked row isn't in the current multi-selection,
    // collapse to just this one (matches Finder behaviour).
    setMultiSelected((prev) => {
      if (prev.has(key)) return prev;
      return new Set([key]);
    });
    setLastClickedKey(key);
    setContextMenu({ x: e.clientX, y: e.clientY, targetKey: key, targetPath: path, targetStaged: isStaged });
  };

  /** Resolve which rows the context menu should operate on. If the
   *  right-clicked row is part of a multi-selection, all of them.
   *  Otherwise just the single row. Returns paths split by where they
   *  came from so callers can route to stage/unstage/discard. */
  const contextTargets = useMemo(() => {
    const out = { stagedPaths: [] as string[], unstagedPaths: [] as string[], untrackedPaths: [] as string[] };
    if (!contextMenu) return out;
    const keys =
      multiSelected.size > 0 && multiSelected.has(contextMenu.targetKey)
        ? multiSelected
        : new Set([contextMenu.targetKey]);
    const byKey = new Map(allRows.map((r) => [r.key, r]));
    for (const k of keys) {
      const row = byKey.get(k);
      if (!row) continue;
      if (row.staged) out.stagedPaths.push(row.path);
      else if (row.isUntracked) out.untrackedPaths.push(row.path);
      else out.unstagedPaths.push(row.path);
    }
    return out;
  }, [contextMenu, multiSelected, allRows]);

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
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            if (!rootDir) return;
            setBusy(true);
            setError(null);
            try {
              const r = await window.marko.gitInit(rootDir);
              if (!r.ok) {
                setError(r.error ?? 'Failed to initialize repository');
                return;
              }
              await refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Initializing…' : 'Initialize Git repository here'}
        </button>
        {error && <div className="git-empty-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="git-view">
      {githubInfo && (
        <GitHubCard
          web={githubInfo.web}
          owner={githubInfo.owner}
          repo={githubInfo.repo}
          branch={currentBranch}
          ghStatus={ghStatus}
          prs={prs}
          issues={issues}
          run={latestRun}
          expanded={showGhDetails}
          onToggle={() => setShowGhDetails((v) => !v)}
          onOpen={openExt}
        />
      )}
      {changelog && (
        <ChangelogCard
          heading={changelog.heading}
          body={changelog.body}
          filename={changelog.filename}
          expanded={showChangelog}
          onToggle={() => setShowChangelog((v) => !v)}
        />
      )}
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
          {githubInfo && (
            <button
              className="git-btn"
              onClick={() => openExt(githubInfo.web)}
              title={`Open ${githubInfo.owner}/${githubInfo.repo} on GitHub`}
            >
              Open ↗
            </button>
          )}
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
            staged
            multiSelected={multiSelected}
            onRowMouseDown={handleRowMouseDown}
            onRowContextMenu={handleRowContextMenu}
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
            staged={false}
            multiSelected={multiSelected}
            onRowMouseDown={handleRowMouseDown}
            onRowContextMenu={handleRowContextMenu}
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
            staged={false}
            multiSelected={multiSelected}
            onRowMouseDown={handleRowMouseDown}
            onRowContextMenu={handleRowContextMenu}
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
                isUntracked={selected.isUntracked}
                repoDir={rootDir}
                relPath={selected.path}
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

      {contextMenu && (
        <GitFileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          stagedPaths={contextTargets.stagedPaths}
          unstagedPaths={contextTargets.unstagedPaths}
          untrackedPaths={contextTargets.untrackedPaths}
          rootDir={rootDir}
          onClose={() => setContextMenu(null)}
          onStage={(paths) => stage(paths)}
          onUnstage={(paths) => unstage(paths)}
          onDiscard={(paths) => discard(paths)}
          onTrashUntracked={(paths) => void trashUntracked(paths)}
        />
      )}
    </div>
  );
}

/** Right-click menu for git file rows. Routes each operation against
 *  the subset of selected files where it actually applies — e.g.
 *  "Stage" only acts on the unstaged + untracked subset, "Unstage"
 *  only on the staged subset. Menu items only render when their
 *  target list is non-empty. */
function GitFileContextMenu({
  x,
  y,
  stagedPaths,
  unstagedPaths,
  untrackedPaths,
  rootDir,
  onClose,
  onStage,
  onUnstage,
  onDiscard,
  onTrashUntracked,
}: {
  x: number;
  y: number;
  stagedPaths: string[];
  unstagedPaths: string[];
  untrackedPaths: string[];
  rootDir: string | null;
  onClose: () => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  onTrashUntracked: (paths: string[]) => void;
}) {
  const totalCount = stagedPaths.length + unstagedPaths.length + untrackedPaths.length;
  const stageable = [...unstagedPaths, ...untrackedPaths];
  const allPaths = [...stagedPaths, ...unstagedPaths, ...untrackedPaths];
  const wrap = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <div
      className="ctx-menu"
      style={{ left: x, top: y, position: 'fixed' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {stageable.length > 0 && (
        <button className="ctx-menu-item" onClick={wrap(() => onStage(stageable))}>
          Stage{stageable.length > 1 ? ` ${stageable.length} files` : ''}
        </button>
      )}
      {stagedPaths.length > 0 && (
        <button className="ctx-menu-item" onClick={wrap(() => onUnstage(stagedPaths))}>
          Unstage{stagedPaths.length > 1 ? ` ${stagedPaths.length} files` : ''}
        </button>
      )}
      {unstagedPaths.length > 0 && (
        <button className="ctx-menu-item" onClick={wrap(() => onDiscard(unstagedPaths))}>
          Discard changes
          {unstagedPaths.length > 1 ? ` (${unstagedPaths.length})` : ''}
        </button>
      )}
      {untrackedPaths.length > 0 && (
        <button className="ctx-menu-item" onClick={wrap(() => onTrashUntracked(untrackedPaths))}>
          Move to Trash
          {untrackedPaths.length > 1 ? ` (${untrackedPaths.length})` : ''}
        </button>
      )}
      {totalCount > 0 && allPaths[0] && (
        <>
          <div className="ctx-menu-sep" />
          <button
            className="ctx-menu-item"
            onClick={wrap(() => {
              const text = allPaths.map((p) => (rootDir ? `${rootDir}/${p}` : p)).join('\n');
              void navigator.clipboard.writeText(text);
            })}
          >
            Copy {totalCount > 1 ? `${totalCount} paths` : 'path'}
          </button>
          {rootDir && (
            <button
              className="ctx-menu-item"
              onClick={wrap(() => void window.marko.revealInFinder(`${rootDir}/${allPaths[0]}`))}
            >
              Reveal in Finder
            </button>
          )}
        </>
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
  staged,
  multiSelected,
  onRowMouseDown,
  onRowContextMenu,
}: {
  title: string;
  count: number;
  files: GitFileEntry[];
  actionLabel: string;
  onAction: () => void;
  onPerFile: (f: GitFileEntry) => void;
  onDiscard?: (f: GitFileEntry) => void;
  selected: SelectedFile | null;
  staged: boolean;
  /** Cmd/Shift-aware mouse handler — see GitView's handleRowMouseDown. */
  onRowMouseDown: (
    key: string,
    path: string,
    isStaged: boolean,
    isUntracked: boolean,
  ) => (e: React.MouseEvent) => void;
  /** Right-click opens the operations menu over the targeted row. */
  onRowContextMenu: (
    key: string,
    path: string,
    isStaged: boolean,
  ) => (e: React.MouseEvent) => void;
  /** Set of row keys (`S:path` or `W:path`) currently part of the
   *  multi-selection — drives the row's `--multi` styling. */
  multiSelected: Set<string>;
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
          const key = `${staged ? 'S' : 'W'}:${f.path}`;
          const isActive =
            selected && selected.path === f.path && selected.staged === staged;
          const isMulti = multiSelected.has(key);
          const isUntracked = f.index === '?' && f.workingDir === '?';
          return (
            <div
              key={key}
              className={
                'git-file' +
                (isActive ? ' git-file--active' : '') +
                (isMulti ? ' git-file--multi' : '')
              }
              onMouseDown={onRowMouseDown(key, f.path, staged, isUntracked)}
              onContextMenu={onRowContextMenu(key, f.path, staged)}
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

/** Per-gap reveal state — how many lines have been loaded from the
 *  top of the gap (going down) vs the bottom (going up). `total` is
 *  the post-image file length once discovered (only matters for the
 *  trailing gap; for inter-hunk gaps the bound comes from the next
 *  hunk's start). */
interface GapState {
  topLines: string[];
  bottomLines: string[];
  total: number | null;
  loadingTop: boolean;
  loadingBottom: boolean;
}
const EXPAND_STEP = 10;

function DiffWithHunks({
  text,
  loading,
  staged,
  isUntracked,
  repoDir,
  relPath,
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
  isUntracked: boolean;
  repoDir: string | null;
  relPath: string;
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
  // Per-gap reveal state. Reset when the file or its diff changes —
  // a different file's hunk indices have nothing to do with this map.
  const [gaps, setGaps] = useState<Map<number, GapState>>(new Map());
  useEffect(() => {
    setGaps(new Map());
  }, [text, relPath]);

  // Source for context-line reads: working tree for unstaged, index
  // for staged. (Untracked files don't have any context to expand into
  // — the diff already contains every line.)
  const source: 'work' | 'index' = staged ? 'index' : 'work';
  const canExpand = !isUntracked && !!repoDir;

  /** Fetch a slice of lines from the chosen source, handling errors
   *  gracefully (failed expand → leave state unchanged). */
  const fetchLines = useCallback(
    async (start: number, end: number): Promise<{ lines: string[]; total: number } | null> => {
      if (!repoDir || start > end) return null;
      const r = await window.marko.gitFileLines(repoDir, source, relPath, start, end);
      if (!r.ok || !r.lines) return null;
      return { lines: r.lines, total: r.total ?? 0 };
    },
    [repoDir, source, relPath],
  );

  /** Hunk header parser: extracts the post-image (new file) line
   *  range. `@@ -a,b +c,d @@` → { start: c, count: d }. `d` is
   *  optional; defaults to 1 when the hunk affects exactly one line. */
  const newRangeOf = useCallback((header: string): { start: number; count: number } => {
    const m = /\+(\d+)(?:,(\d+))?/.exec(header);
    if (!m) return { start: 1, count: 0 };
    return { start: parseInt(m[1], 10), count: m[2] ? parseInt(m[2], 10) : 1 };
  }, []);
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

  /** Gap bounds in post-image (new file) line numbers, indexed by
   *  gapIdx 0..hunks.length. The leading gap (gi=0) sits before the
   *  first hunk; the trailing gap (gi=hunks.length) sits after the
   *  last. For inter-hunk gaps both bounds are known from the headers;
   *  the trailing gap's `bottom` is null until we discover EOF on the
   *  first expand click. */
  const gapBounds = useMemo(() => {
    if (!parsed) return [] as { top: number; bottom: number | null }[];
    const out: { top: number; bottom: number | null }[] = [];
    for (let gi = 0; gi <= parsed.hunks.length; gi++) {
      const prev = gi === 0 ? null : newRangeOf(parsed.hunks[gi - 1].header);
      const next = gi === parsed.hunks.length ? null : newRangeOf(parsed.hunks[gi].header);
      const top = prev ? prev.start + prev.count : 1;
      const bottom = next ? next.start - 1 : null;
      out.push({ top, bottom });
    }
    return out;
  }, [parsed, newRangeOf]);

  /** Mutate one gap's state via a producer so hooks-rules-friendly
   *  React updates flow through a single setter. */
  const updateGap = useCallback((gi: number, fn: (g: GapState) => GapState) => {
    setGaps((prev) => {
      const next = new Map(prev);
      const cur = next.get(gi) ?? {
        topLines: [],
        bottomLines: [],
        total: null,
        loadingTop: false,
        loadingBottom: false,
      };
      next.set(gi, fn(cur));
      return next;
    });
  }, []);

  /** Append `count` more lines at the top of gap `gi` (going down). */
  const expandTop = useCallback(
    async (gi: number, count: number) => {
      const bounds = gapBounds[gi];
      if (!bounds) return;
      const cur = gaps.get(gi);
      const topRevealed = cur?.topLines.length ?? 0;
      const bottomRevealed = cur?.bottomLines.length ?? 0;
      const total = cur?.total ?? null;
      const start = bounds.top + topRevealed;
      // Don't run past the bottom edge of the gap (or the file's EOF
      // for the trailing gap once total is known).
      const hardStop =
        bounds.bottom != null
          ? bounds.bottom - bottomRevealed
          : total != null
            ? total - bottomRevealed
            : start + count - 1;
      const end = Math.min(start + count - 1, hardStop);
      if (start > end) return;
      updateGap(gi, (g) => ({ ...g, loadingTop: true }));
      const res = await fetchLines(start, end);
      updateGap(gi, (g) => ({
        ...g,
        loadingTop: false,
        topLines: [...g.topLines, ...(res?.lines ?? [])],
        total: res?.total ?? g.total,
      }));
    },
    [gapBounds, gaps, fetchLines, updateGap],
  );

  /** Prepend `count` more lines at the bottom of gap `gi` (going up).
   *  Only meaningful when we know where the bottom is — for the
   *  trailing gap, the user has to click expand-top first to learn
   *  the file's total length. */
  const expandBottom = useCallback(
    async (gi: number, count: number) => {
      const bounds = gapBounds[gi];
      if (!bounds) return;
      const cur = gaps.get(gi);
      const topRevealed = cur?.topLines.length ?? 0;
      const bottomRevealed = cur?.bottomLines.length ?? 0;
      const bottom = bounds.bottom != null ? bounds.bottom : cur?.total;
      if (bottom == null) return;
      const end = bottom - bottomRevealed;
      const start = Math.max(end - count + 1, bounds.top + topRevealed);
      if (start > end) return;
      updateGap(gi, (g) => ({ ...g, loadingBottom: true }));
      const res = await fetchLines(start, end);
      updateGap(gi, (g) => ({
        ...g,
        loadingBottom: false,
        bottomLines: [...(res?.lines ?? []), ...g.bottomLines],
        total: res?.total ?? g.total,
      }));
    },
    [gapBounds, gaps, fetchLines, updateGap],
  );

  /** Reveal everything between the current top and bottom revealed
   *  edges of gap `gi`. Cheap when the gap is small; when the gap is
   *  huge (e.g., expanding a big file's tail), the IPC handler caps
   *  at the file's actual length. */
  const expandAll = useCallback(
    async (gi: number) => {
      const bounds = gapBounds[gi];
      if (!bounds) return;
      const cur = gaps.get(gi);
      const topRevealed = cur?.topLines.length ?? 0;
      const bottomRevealed = cur?.bottomLines.length ?? 0;
      const bottom = bounds.bottom != null ? bounds.bottom : cur?.total;
      if (bottom == null) return;
      const start = bounds.top + topRevealed;
      const end = bottom - bottomRevealed;
      if (start > end) return;
      updateGap(gi, (g) => ({ ...g, loadingTop: true }));
      const res = await fetchLines(start, end);
      updateGap(gi, (g) => ({
        ...g,
        loadingTop: false,
        topLines: [...g.topLines, ...(res?.lines ?? [])],
        total: res?.total ?? g.total,
      }));
    },
    [gapBounds, gaps, fetchLines, updateGap],
  );

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
        const gap = gaps.get(hi);
        const bounds = gapBounds[hi];
        const showLeadingGap = canExpand && bounds && (bounds.bottom == null || bounds.bottom >= bounds.top);
        return (
          <React.Fragment key={hi}>
            {showLeadingGap && (
              <DiffGap
                gi={hi}
                top={bounds.top}
                bottom={bounds.bottom}
                state={gap}
                onExpandTop={() => void expandTop(hi, EXPAND_STEP)}
                onExpandBottom={() => void expandBottom(hi, EXPAND_STEP)}
                onExpandAll={() => void expandAll(hi)}
              />
            )}
            <div className="git-hunk">
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
          </React.Fragment>
        );
      })}
      {canExpand && parsed.hunks.length > 0 && gapBounds.length > parsed.hunks.length && (
        <DiffGap
          gi={parsed.hunks.length}
          top={gapBounds[parsed.hunks.length].top}
          bottom={gapBounds[parsed.hunks.length].bottom}
          state={gaps.get(parsed.hunks.length)}
          onExpandTop={() => void expandTop(parsed.hunks.length, EXPAND_STEP)}
          onExpandBottom={() => void expandBottom(parsed.hunks.length, EXPAND_STEP)}
          onExpandAll={() => void expandAll(parsed.hunks.length)}
        />
      )}
    </div>
  );
}

/** GitHub-style expand-context bar between hunks. Renders as a single
 *  thin line that mimics the diff's hunk-header styling — same blue
 *  tint, same monospace, no chunky pill buttons. Three compact icon
 *  buttons:
 *    ↑ N   reveal the N lines just after the previous hunk (display
 *          above the bar)
 *    ⇕ all reveal everything between the two reveal pointers
 *    ↓ N   reveal the N lines just before the next hunk (display
 *          below the bar)
 *  Suppressed entirely once the gap is fully revealed. */
function DiffGap({
  gi,
  top,
  bottom,
  state,
  onExpandTop,
  onExpandBottom,
  onExpandAll,
}: {
  gi: number;
  top: number;
  bottom: number | null;
  state: GapState | undefined;
  onExpandTop: () => void;
  onExpandBottom: () => void;
  onExpandAll: () => void;
}) {
  const topLines = state?.topLines ?? [];
  const bottomLines = state?.bottomLines ?? [];
  const total = state?.total ?? null;

  // Effective bottom — the inter-hunk case knows it from the next
  // hunk header; the trailing case learns it from the IPC's `total`.
  const effBottom = bottom ?? total;
  const fullyRevealed =
    effBottom != null && top + topLines.length > effBottom - bottomLines.length;
  const knowsBottom = effBottom != null;
  const remaining =
    effBottom != null
      ? Math.max(0, effBottom - (top + topLines.length) + 1 - bottomLines.length)
      : null;

  return (
    <div className="git-diff-gap" data-gap-idx={gi}>
      {topLines.map((line, i) => (
        <div key={`top-${i}`} className="git-diff-line git-diff-line--context">
          {' ' + (line || '')}
        </div>
      ))}
      {!fullyRevealed && (
        <div className="git-diff-gap-bar">
          <button
            className="git-diff-gap-btn"
            onClick={onExpandTop}
            disabled={state?.loadingTop || remaining === 0}
            title="Reveal more lines after the previous hunk"
            aria-label="Expand up"
          >
            ↑ {EXPAND_STEP}
          </button>
          <button
            className="git-diff-gap-btn git-diff-gap-btn--all"
            onClick={onExpandAll}
            disabled={!knowsBottom || state?.loadingTop || remaining === 0}
            title={knowsBottom ? `Reveal all ${remaining} lines` : 'Click ↑ first to discover EOF'}
          >
            {knowsBottom && remaining != null ? `Expand all (${remaining})` : 'Expand all'}
          </button>
          <button
            className="git-diff-gap-btn"
            onClick={onExpandBottom}
            disabled={!knowsBottom || state?.loadingBottom || remaining === 0}
            title={knowsBottom ? 'Reveal more lines before the next hunk' : 'Trailing gap — click ↑ first to discover EOF'}
            aria-label="Expand down"
          >
            ↓ {EXPAND_STEP}
          </button>
        </div>
      )}
      {bottomLines.map((line, i) => (
        <div key={`bot-${i}`} className="git-diff-line git-diff-line--context">
          {' ' + (line || '')}
        </div>
      ))}
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

/** RepoBar-inspired strip below the toolbar — owner/repo, PR/issue
 *  counts, and CI badge for the current branch. Click any chip to
 *  open the corresponding GitHub page externally. Expands into a
 *  short list of PRs + issues so the most common "what's open right
 *  now?" question is answerable without context-switching. */
function GitHubCard({
  web,
  owner,
  repo,
  branch,
  ghStatus,
  prs,
  issues,
  run,
  expanded,
  onToggle,
  onOpen,
}: {
  web: string;
  owner: string;
  repo: string;
  branch: string | null;
  ghStatus: { available: boolean; authed: boolean } | null;
  prs: GhPr[] | null;
  issues: GhIssue[] | null;
  run: GhRun | null;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (url: string) => void;
}) {
  // Open PRs/issues only — gh's default `pr list` already filters
  // closed, but the JSON includes state for safety. Drafts stay
  // counted because users still want to see them as "in flight".
  const openPrs = useMemo(() => prs?.filter((p) => p.state === 'OPEN') ?? null, [prs]);
  const openIssues = useMemo(() => issues?.filter((i) => i.state === 'OPEN') ?? null, [issues]);

  const ciBadge = ciBadgeFor(run);

  return (
    <div className="git-gh-card">
      <button
        className="git-gh-card-row"
        onClick={onToggle}
        aria-expanded={expanded}
        title={`Toggle ${owner}/${repo} GitHub details`}
      >
        <span className="git-section-arrow">{expanded ? '▼' : '▶'}</span>
        <a
          className="git-gh-card-slug"
          href={web}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpen(web);
          }}
        >
          {owner}/{repo}
        </a>
        {ghStatus && !ghStatus.available && (
          <span className="git-gh-card-hint" title="Install: brew install gh">
            install gh CLI for PRs/issues
          </span>
        )}
        {ghStatus?.available && !ghStatus.authed && (
          <span className="git-gh-card-hint" title="Run: gh auth login">
            run `gh auth login` for PRs/issues
          </span>
        )}
        {ghStatus?.authed && (
          <>
            <span
              className="git-gh-card-chip"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpen(`${web}/pulls`);
              }}
              role="button"
              tabIndex={0}
            >
              {openPrs == null ? '…' : openPrs.length} PR{openPrs?.length === 1 ? '' : 's'}
            </span>
            <span
              className="git-gh-card-chip"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpen(`${web}/issues`);
              }}
              role="button"
              tabIndex={0}
            >
              {openIssues == null ? '…' : openIssues.length} issue
              {openIssues?.length === 1 ? '' : 's'}
            </span>
            {branch && (
              <span
                className={`git-gh-card-chip git-gh-card-chip--ci git-gh-card-chip--ci-${ciBadge.kind}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (run?.url) onOpen(run.url);
                  else onOpen(`${web}/actions?query=branch%3A${encodeURIComponent(branch)}`);
                }}
                role="button"
                tabIndex={0}
                title={ciBadge.title}
              >
                {ciBadge.glyph} {ciBadge.label}
              </span>
            )}
          </>
        )}
      </button>
      {expanded && ghStatus?.authed && (
        <div className="git-gh-card-body">
          <GhList
            label="Open Pull Requests"
            empty="No open PRs."
            items={openPrs}
            onOpen={onOpen}
            renderItem={(p) => (
              <span>
                <span className="git-gh-num">#{p.number}</span> {p.title}
                <span className="git-gh-meta">
                  {' '}
                  · {p.headRefName}
                  {p.isDraft && ' · draft'}
                </span>
              </span>
            )}
            urlOf={(p) => p.url}
          />
          <GhList
            label="Open Issues"
            empty="No open issues."
            items={openIssues}
            onOpen={onOpen}
            renderItem={(i) => (
              <span>
                <span className="git-gh-num">#{i.number}</span> {i.title}
              </span>
            )}
            urlOf={(i) => i.url}
          />
        </div>
      )}
    </div>
  );
}

function GhList<T>({
  label,
  empty,
  items,
  onOpen,
  renderItem,
  urlOf,
}: {
  label: string;
  empty: string;
  items: T[] | null;
  onOpen: (url: string) => void;
  renderItem: (item: T) => React.ReactNode;
  urlOf: (item: T) => string;
}) {
  return (
    <div className="git-gh-list">
      <div className="git-gh-list-label">{label}</div>
      {items == null ? (
        <div className="git-gh-list-empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="git-gh-list-empty">{empty}</div>
      ) : (
        items.slice(0, 8).map((it, idx) => (
          <button key={idx} className="git-gh-list-row" onClick={() => onOpen(urlOf(it))}>
            {renderItem(it)}
          </button>
        ))
      )}
    </div>
  );
}

/** Map a workflow run into a small badge. Status precedes conclusion
 *  because a run can be in_progress with conclusion: null — that's the
 *  "running" indicator, not a failure. */
function ciBadgeFor(
  run: GhRun | null,
): { kind: 'ok' | 'fail' | 'run' | 'none'; glyph: string; label: string; title: string } {
  if (!run) return { kind: 'none', glyph: '·', label: 'no CI', title: 'No workflow runs found' };
  if (run.status !== 'completed') {
    return {
      kind: 'run',
      glyph: '⊙',
      label: run.status.replace('_', ' '),
      title: `${run.workflowName} — ${run.status}`,
    };
  }
  if (run.conclusion === 'success') {
    return { kind: 'ok', glyph: '✓', label: 'CI', title: `${run.workflowName} — success` };
  }
  if (run.conclusion === 'failure' || run.conclusion === 'cancelled') {
    return {
      kind: 'fail',
      glyph: '✗',
      label: run.conclusion ?? 'failed',
      title: `${run.workflowName} — ${run.conclusion}`,
    };
  }
  return {
    kind: 'none',
    glyph: '·',
    label: run.conclusion ?? '—',
    title: `${run.workflowName} — ${run.conclusion ?? 'unknown'}`,
  };
}

/** Collapsed: heading + filename. Expanded: body in a scrollable
 *  block. The body is rendered as <pre> to preserve markdown's
 *  intentional whitespace without pulling in the full Crepe renderer
 *  for what's usually a short release note. Only rendered when a
 *  release-notes file actually exists. */
function ChangelogCard({
  heading,
  body,
  filename,
  expanded,
  onToggle,
}: {
  heading: string;
  body: string;
  filename: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="git-changelog-card">
      <button
        className="git-changelog-row"
        onClick={onToggle}
        aria-expanded={expanded}
        title={`From ${filename}`}
      >
        <span className="git-section-arrow">{expanded ? '▼' : '▶'}</span>
        <span className="git-changelog-label">{filename}</span>
        <span className="git-changelog-heading">{heading}</span>
      </button>
      {expanded && body && <pre className="git-changelog-body">{body}</pre>}
    </div>
  );
}
