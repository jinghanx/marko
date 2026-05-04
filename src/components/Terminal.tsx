import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { useWorkspace, workspace, subscribeWorkspace, getActiveSession } from '../state/workspace';
import { useActiveTheme, useSettings } from '../state/settings';
import { xtermThemeFor } from '../lib/themes';
import { openFileFromPath, openFolderInEditor, openUrlInTab } from '../lib/actions';
import '@xterm/xterm/css/xterm.css';

const AI_SYSTEM_PROMPT = [
  'You are a shell command generator running inside Marko, a macOS terminal.',
  'The user describes what they want in natural language; you reply with ONLY the single shell command that does it.',
  'Strict rules:',
  '- Output exactly one command — no explanation, no markdown, no code fences, no leading "$" or ">".',
  '- The shell is zsh. Prefer portable POSIX-ish syntax when possible.',
  '- If the request is ambiguous, pick the most common interpretation; do not ask back.',
  '- Never include a trailing newline.',
].join(' ');

function sanitizeCommand(text: string): string {
  let s = text.trim();
  // Strip ``` fences (with or without language tag).
  s = s.replace(/^```[a-zA-Z0-9]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  // Strip leading prompt sigils.
  s = s.replace(/^[$>] ?/, '');
  // Collapse any accidental multi-line output to its first line.
  s = s.split('\n')[0].trim();
  // Remove wrapping backticks if the model returned `cmd`.
  if (s.startsWith('`') && s.endsWith('`')) s = s.slice(1, -1);
  return s;
}

interface Props {
  tabId: string;
}

/** Match `path` or `path:line` or `path:line:col` (relative or absolute,
 *  Unix-style). Avoids URLs (anything that looks like a scheme://). The
 *  trailing optional `:lineNo` lets us deep-link to a specific line. */
const FILE_PATH_RE =
  /(?<![:/\w@])(\.{0,2}\/[\w./@\-+]+|\/[\w./@\-+]+|[\w./\-+]+\.[\w-]+)(?::(\d+))?(?::(\d+))?/g;

/** URL detector for terminal links. Three flavors are recognized:
 *    1. Explicit-scheme:        https://… / http://… / file://…
 *    2. www-prefixed bare hosts: www.example.com[/path]
 *    3. Bare multi-segment hosts ending in a known TLD, with optional path:
 *       app.pacifica.fi[/dashboard]
 *  The TLD list keeps us from misfiring on things like `app.tsx` (`.tsx`
 *  isn't in the list). Trailing punctuation is stripped in the activate
 *  handler so a URL at the end of a sentence doesn't grab the period. */
const URL_TLDS =
  'com|org|net|io|dev|app|co|me|ai|gg|xyz|tv|ly|fm|sh|so|info|biz|edu|gov|' +
  'us|uk|ca|de|fr|jp|cn|in|br|ru|au|nz|fi|dk|pl|no|se|nl|es|it|kr|sg|hk|tw|' +
  'mx|to|tt|gl|ch|at|be|ie|cz|gr|hu|pt|ro|ua|tr|il|ar|cl|za|sa|ae|id|my|th|vn';
const URL_LINK_RE = new RegExp(
  '(?:' +
    '(?:https?|file)://[^\\s<>"\']+' +
    '|' +
    'www\\.[^\\s<>"\']+' +
    '|' +
    '(?<![\\w./])(?:[\\w-]+\\.)+(?:' + URL_TLDS + ')' +
    '(?:[/?#][^\\s<>"\']*)?(?=\\s|$|[)\\].,;:!?"\'])' +
  ')',
  'g',
);

/** Hidden offscreen container where xterm's DOM element parks while
 *  the React Terminal component is unmounted (e.g., during a pane
 *  split). Without this, React removes the host div from the document
 *  while xterm's element is still its child — orphaning it. xterm
 *  internally caches `_core.element`; if we don't explicitly move it
 *  out of the doomed host first, the move-to-new-host on next mount
 *  can leave the renderer in a bad state. */
let terminalLimbo: HTMLDivElement | null = null;
function getTerminalLimbo(): HTMLDivElement {
  if (!terminalLimbo || !terminalLimbo.isConnected) {
    terminalLimbo = document.createElement('div');
    terminalLimbo.style.cssText =
      'position:absolute; left:-9999px; top:-9999px; width:1px; height:1px; overflow:hidden; pointer-events:none;';
    document.body.appendChild(terminalLimbo);
  }
  return terminalLimbo;
}

/** Persistent terminal session — outlives the React component instance.
 *  When the pane tree restructures (split, close, etc.), React unmounts
 *  the Terminal component, but the xterm + pty live in this map keyed
 *  by tabId. The next mount reattaches the same xterm to its new host
 *  via term.open(), so the running shell, scrollback, and process all
 *  survive the tree change. Sessions are destroyed only when the tab
 *  itself is closed (see ensureSessionCleanupSubscribed). */
interface TermSession {
  term: XTerm;
  fit: FitAddon;
  search: SearchAddon;
  ptyId: string;
  inputDispose: () => void;
  ptyDataDispose: () => void;
  ptyExitDispose: () => void;
}
const terminalSessions = new Map<string, TermSession>();
let cleanupSubscribed = false;
function ensureSessionCleanupSubscribed() {
  if (cleanupSubscribed) return;
  cleanupSubscribed = true;
  let tracked = new Set<string>();
  subscribeWorkspace(() => {
    const tabs = workspace.getState().tabs;
    const currentIds = new Set(
      tabs.filter((t) => t.kind === 'terminal').map((t) => t.id),
    );
    for (const id of tracked) {
      if (!currentIds.has(id)) destroyTerminalSession(id);
    }
    tracked = currentIds;
  });
}
function destroyTerminalSession(tabId: string) {
  const sess = terminalSessions.get(tabId);
  if (!sess) return;
  try { sess.inputDispose(); } catch { /* ignore */ }
  try { sess.ptyDataDispose(); } catch { /* ignore */ }
  try { sess.ptyExitDispose(); } catch { /* ignore */ }
  try { sess.term.dispose(); } catch { /* ignore */ }
  void window.marko.ptyKill(sess.ptyId);
  terminalSessions.delete(tabId);
}
function getOrCreateTerminalSession(
  tabId: string,
  opts: { rootDir: string | null; codeFont: string; theme: ReturnType<typeof xtermThemeFor> | Parameters<typeof xtermThemeFor>[0] },
): TermSession {
  const existing = terminalSessions.get(tabId);
  if (existing) return existing;
  const term = new XTerm({
    cursorBlink: true,
    fontFamily: opts.codeFont,
    fontSize: 13,
    lineHeight: 1.2,
    // The theme arg can be either pre-built or the active-theme value;
    // xtermThemeFor is idempotent so accept either path.
    theme: typeof opts.theme === 'object' && 'background' in (opts.theme as object)
      ? (opts.theme as ReturnType<typeof xtermThemeFor>)
      : xtermThemeFor(opts.theme as Parameters<typeof xtermThemeFor>[0]),
    scrollback: 10000,
    allowProposedApi: true,
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);

  const ptyId = `pty-${tabId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inputDisposable = term.onData((data) => {
    void window.marko.ptyWrite(ptyId, data);
  });
  const sess: TermSession = {
    term,
    fit,
    search,
    ptyId,
    inputDispose: () => inputDisposable.dispose(),
    // ptyData / ptyExit subscriptions are wired after the spawn
    // resolves (we need to know the spawn succeeded). They reassign
    // these via closure capture below.
    ptyDataDispose: () => {},
    ptyExitDispose: () => {},
  };
  void window.marko
    .ptySpawn(ptyId, { cwd: opts.rootDir ?? undefined, cols: term.cols, rows: term.rows })
    .then((r) => {
      if (!r.ok) {
        term.writeln(`\x1b[31mFailed to start shell: ${r.error}\x1b[0m`);
        return;
      }
      sess.ptyDataDispose = window.marko.onPtyData(ptyId, (data) => term.write(data));
      sess.ptyExitDispose = window.marko.onPtyExit(ptyId, () => {
        term.writeln('\r\n\x1b[2m[shell exited]\x1b[0m');
      });
      // rc files often `cd $HOME` on shell startup, undoing the spawn
      // cwd. Send an explicit cd after they've run.
      if (opts.rootDir) {
        const escaped = opts.rootDir.replace(/'/g, `'\\''`);
        setTimeout(() => {
          void window.marko.ptyWrite(ptyId, ` cd '${escaped}' && clear\r`);
        }, 120);
      }
    });
  terminalSessions.set(tabId, sess);
  return sess;
}

export function Terminal({ tabId }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  // Smooth-glide custom cursor (mirrors the launcher input's lerping
  // caret). xterm's built-in cursor is hidden via CSS; this DOM
  // overlay tracks the buffer cursor and slides between positions.
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const cursorTargetRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const cursorCurrentRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const rootDir = useWorkspace((s) => getActiveSession(s).rootDir);
  const codeFont = useSettings().codeFont;
  const activeTheme = useActiveTheme();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // AI command generation (Cmd+I).
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiInputRef = useRef<HTMLInputElement | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const aiReqRef = useRef<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Session is the source of truth for the xterm + pty pair. It
    // survives React unmounts (e.g., pane splits) so the running
    // shell, scrollback, and process are preserved across tree
    // restructures. Disposed only when the tab itself is closed.
    ensureSessionCleanupSubscribed();
    const sess = getOrCreateTerminalSession(tabId, {
      rootDir,
      codeFont,
      theme: activeTheme,
    });
    const term = sess.term;
    const fit = sess.fit;
    const search = sess.search;
    const ptyId = sess.ptyId;
    ptyIdRef.current = ptyId;

    // URL link provider. The bundled WebLinksAddon's activation gating is
    // unreliable across versions (and was eating clicks here), so we own
    // the regex + activate path directly.
    const urlLinkDispose = term.registerLinkProvider({
      provideLinks(_lineNum, callback) {
        const buffer = term.buffer.active;
        const line = buffer.getLine(_lineNum - 1);
        if (!line) {
          callback(undefined);
          return;
        }
        const text = line.translateToString(true);
        const out: Array<{
          range: { start: { x: number; y: number }; end: { x: number; y: number } };
          text: string;
          activate: (event: MouseEvent) => void;
        }> = [];
        URL_LINK_RE.lastIndex = 0;
        let urlMatch: RegExpExecArray | null;
        while ((urlMatch = URL_LINK_RE.exec(text)) !== null) {
          // Strip common trailing punctuation that's almost always not part
          // of the URL (e.g., `see https://example.com.`).
          let raw = urlMatch[0];
          const trail = raw.match(/[)\].,;:!?'"]+$/);
          if (trail) raw = raw.slice(0, raw.length - trail[0].length);
          if (raw.length < 8) continue;
          const start = urlMatch.index;
          const end = start + raw.length;
          const uri = raw;
          out.push({
            range: {
              start: { x: start + 1, y: _lineNum },
              end: { x: end, y: _lineNum },
            },
            text: raw,
            activate: () => {
              workspace.openInSide(() => openUrlInTab(uri), tabId);
            },
          });
        }
        callback(out.length > 0 ? out : undefined);
      },
    });

    // Click-to-open file paths. Each matching link gets registered; when
    // clicked we resolve relative paths against the workspace rootDir and
    // open the file (with optional line jump).
    const linkDispose = term.registerLinkProvider({
      provideLinks(_lineNum, callback) {
        const buffer = term.buffer.active;
        const line = buffer.getLine(_lineNum - 1);
        if (!line) {
          callback(undefined);
          return;
        }
        const text = line.translateToString(true);
        const links: Array<{
          range: { start: { x: number; y: number }; end: { x: number; y: number } };
          text: string;
          activate: (event: MouseEvent) => void;
        }> = [];
        FILE_PATH_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = FILE_PATH_RE.exec(text)) !== null) {
          const matchedText = m[0];
          // Drop trivial/false-positive matches: bare extension-only,
          // protocol-prefixed, or anything obviously not a real file.
          if (matchedText.startsWith('http')) continue;
          if (matchedText.length < 3) continue;
          // If this region looks more like a URL (www.foo.com, github.io,
          // etc.), let the URL provider handle it instead of statting and
          // failing.
          URL_LINK_RE.lastIndex = 0;
          if (URL_LINK_RE.test(matchedText)) continue;
          // Snapshot the match data — every activate handler that the loop
          // pushes shares the *same* `m` reference, so the value of `m[1]`
          // by the time the user clicks would be `null` (loop exit). Pin
          // the path + line number now.
          const pathOnly = m[1];
          const linePart = m[2] ? parseInt(m[2], 10) : undefined;
          const start = m.index;
          const end = start + matchedText.length;
          links.push({
            range: {
              start: { x: start + 1, y: _lineNum },
              end: { x: end, y: _lineNum },
            },
            text: matchedText,
            activate: () => {
              const abs = pathOnly.startsWith('/')
                ? pathOnly
                : `${rootDir ?? ''}/${pathOnly}`;
              void window.marko.stat(abs).then((stat) => {
                if (!stat.exists) return;
                // Files and folders both open as tabs in the side pane so
                // the terminal stays put. Folder gets a folder-view tab,
                // file gets routed by `openFileFromPath` to the right kind.
                workspace.openInSide(async () => {
                  if (stat.isDirectory) {
                    await openFolderInEditor(abs, { focus: true });
                  } else {
                    await openFileFromPath(abs, { focus: true });
                    if (linePart) {
                      // Defer slightly so the editor has time to mount.
                      setTimeout(() => {
                        window.dispatchEvent(
                          new CustomEvent('marko:goto-line', {
                            detail: { path: abs, line: linePart },
                          }),
                        );
                      }, 80);
                    }
                  }
                }, tabId);
              });
            },
          });
        }
        callback(links.length > 0 ? links : undefined);
      },
    });

    // First mount: xterm hasn't rendered yet — open it against this
    // host. Re-mount (after a pane split): adopt the already-rendered
    // element into the new host. We avoid calling term.open() twice
    // because xterm's renderer caches the original parent's geometry
    // and gets confused when re-opened against a new one.
    if (!term.element) {
      term.open(host);
    } else if (term.element.parentElement !== host) {
      host.appendChild(term.element);
    }
    try { fit.fit(); } catch { /* fit can throw mid-resize */ }
    xtermRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    // ---- smooth-glide cursor ----------------------------------------
    // Track xterm's logical cursor position and drive a DOM overlay
    // that lerps toward it each animation frame. Same easing model as
    // the launcher input (k=0.35: snappy on backspace, readable on
    // glide). xterm's native cursor layer is hidden via CSS so the
    // overlay is the only thing the user sees blink/move.
    const computeCursorTarget = () => {
      const cursor = cursorRef.current;
      if (!cursor) return;
      // The overlay sits in .terminal-wrap; xterm renders into
      // .xterm-screen inside .terminal-host. Compute the screen's
      // offset within the wrap and add it to the per-cell cursor
      // coordinates so the overlay lands exactly on the grid.
      const screen = host.querySelector('.xterm-screen') as HTMLElement | null;
      const box = screen ?? host;
      const cellW = box.clientWidth / term.cols;
      const cellH = box.clientHeight / term.rows;
      if (cellW <= 0 || cellH <= 0) return;
      const wrap = cursor.parentElement;
      let offsetX = 0;
      let offsetY = 0;
      if (wrap) {
        const wrapRect = wrap.getBoundingClientRect();
        const boxRect = box.getBoundingClientRect();
        offsetX = boxRect.left - wrapRect.left;
        offsetY = boxRect.top - wrapRect.top;
      }
      const buf = term.buffer.active;
      cursorTargetRef.current = {
        x: offsetX + buf.cursorX * cellW,
        y: offsetY + buf.cursorY * cellH,
        w: cellW,
        h: cellH,
      };
    };
    const cursorMoveDispose = term.onCursorMove(computeCursorTarget);
    const cursorResizeDispose = term.onResize(computeCursorTarget);
    // Initial position once xterm has measured its cells.
    requestAnimationFrame(() => {
      computeCursorTarget();
      // Snap on first frame so the overlay doesn't fly in from (0,0).
      cursorCurrentRef.current = { ...cursorTargetRef.current };
    });
    let cursorRaf = 0;
    const cursorTick = () => {
      const cursor = cursorRef.current;
      const t = cursorTargetRef.current;
      const c = cursorCurrentRef.current;
      const k = 0.35;
      c.x += (t.x - c.x) * k;
      c.y += (t.y - c.y) * k;
      c.w += (t.w - c.w) * k;
      c.h += (t.h - c.h) * k;
      if (cursor) {
        cursor.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
        cursor.style.width = `${c.w}px`;
        cursor.style.height = `${c.h}px`;
      }
      cursorRaf = requestAnimationFrame(cursorTick);
    };
    cursorRaf = requestAnimationFrame(cursorTick);
    // ---- end smooth-glide cursor ------------------------------------

    // pty spawn + I/O bridges (term ⇄ pty) are wired at session
    // creation in getOrCreateTerminalSession, not per-mount, so they
    // survive a pane-split-induced React remount.

    // Cmd+F opens the search overlay; Cmd+K clears the scrollback. Wired on
    // the host element so they only fire when the terminal has focus.
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      } else if (e.key === 'k') {
        e.preventDefault();
        term.clear();
      } else if (e.key === 'i') {
        e.preventDefault();
        setAiOpen(true);
        setAiError(null);
        requestAnimationFrame(() => aiInputRef.current?.focus());
      }
    };
    host.addEventListener('keydown', onKeyDown);

    // Drag-and-drop file paths into the terminal — same UX as Ghostty,
    // Terminal.app, iTerm. Drop a file/folder from Finder (or anywhere
    // else) onto the terminal and its absolute path is typed in,
    // shell-quoted so spaces / special chars don't break the command.
    // Useful for piping things into `claude` / `codex` / `cat` etc.
    const shellQuote = (p: string): string => {
      // Single-quote and escape any embedded single quotes by closing
      // the quoted run, escaping the quote, and reopening — the
      // standard POSIX trick: `' \' '` becomes `'\''`.
      return `'${p.replace(/'/g, `'\\''`)}'`;
    };
    const onDragOver = (e: DragEvent) => {
      // dataTransfer.types is the only thing we can inspect during
      // dragover (the file list is hidden until drop). Accept anything
      // that looks file-shaped.
      if (
        e.dataTransfer?.types.includes('Files') ||
        e.dataTransfer?.types.includes('text/uri-list')
      ) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const onDrop = (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      // Prefer the URI list (carries the actual filesystem paths).
      // `dt.files` has File objects but no full path on the web —
      // Electron's File extends with `path`, so we fall back to that.
      const paths: string[] = [];
      const uri = dt.getData('text/uri-list');
      if (uri) {
        for (const line of uri.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          if (trimmed.startsWith('file://')) {
            try {
              paths.push(decodeURIComponent(new URL(trimmed).pathname));
            } catch {
              /* malformed line — skip */
            }
          } else {
            paths.push(trimmed);
          }
        }
      }
      if (paths.length === 0 && dt.files && dt.files.length > 0) {
        for (const f of Array.from(dt.files)) {
          // Electron exposes `path` on File for desktop drops.
          const p = (f as File & { path?: string }).path;
          if (p) paths.push(p);
        }
      }
      if (paths.length === 0) return;
      e.preventDefault();
      const out = paths.map(shellQuote).join(' ') + ' ';
      void window.marko.ptyWrite(ptyId, out);
    };
    host.addEventListener('dragover', onDragOver);
    host.addEventListener('drop', onDrop);

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        void window.marko.ptyResize(ptyId, term.cols, term.rows);
      } catch {
        // ignore measurement glitches during teardown
      }
    });
    ro.observe(host);

    term.focus();

    return () => {
      // Per-mount cleanup ONLY — link providers, key handler, resize
      // observer, cursor RAF. The session (term, pty, I/O) survives
      // so pane splits / tree restructures don't kill the shell.
      host.removeEventListener('keydown', onKeyDown);
      host.removeEventListener('dragover', onDragOver);
      host.removeEventListener('drop', onDrop);
      ro.disconnect();
      cancelAnimationFrame(cursorRaf);
      cursorMoveDispose.dispose();
      cursorResizeDispose.dispose();
      linkDispose.dispose();
      urlLinkDispose.dispose();
      // Park xterm's rendered element offscreen before React removes
      // the host. The next mount adopts it back via appendChild — see
      // the mount block above.
      if (term.element && term.element.parentElement === host) {
        getTerminalLimbo().appendChild(term.element);
      }
      xtermRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
    // Only re-attach the terminal when the tab itself changes. Font /
    // theme are applied live via the two effects below; pty + xterm
    // life-cycle is owned by the module-level session registry.
  }, [tabId]);

  // Live-apply font changes without remounting the terminal. xterm 5
  // exposes options as a writable record; setting fontFamily and
  // re-running fit() is enough to take effect.
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.options.fontFamily = codeFont;
    try { fitRef.current?.fit(); } catch { /* fit can throw mid-resize */ }
  }, [codeFont]);

  // Live-apply theme changes — xterm's theme is a colors object; we
  // build a new one via xtermThemeFor so the ANSI palette tracks the
  // active app theme.
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.options.theme = xtermThemeFor(activeTheme);
  }, [activeTheme]);

  // Drive the search addon when the query changes (live results).
  useEffect(() => {
    if (!searchOpen) return;
    const search = searchRef.current;
    if (!search) return;
    if (searchQuery) {
      search.findNext(searchQuery, { incremental: true });
    }
  }, [searchQuery, searchOpen]);

  const findNext = () => {
    searchRef.current?.findNext(searchQuery, { incremental: false });
  };
  const findPrev = () => {
    searchRef.current?.findPrevious(searchQuery, { incremental: false });
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    searchRef.current?.clearDecorations();
    xtermRef.current?.focus();
  };

  const closeAi = () => {
    if (aiBusy && aiReqRef.current) {
      void window.marko.aiChatCancel(aiReqRef.current);
    }
    setAiOpen(false);
    setAiPrompt('');
    setAiBusy(false);
    setAiError(null);
    aiReqRef.current = null;
    xtermRef.current?.focus();
  };

  /** Pick the best available provider for command generation. Cloud
   *  providers (with a key set) come first — they generally produce better
   *  shell commands than typical local models. Falls back to local if no
   *  cloud keys are configured. */
  const pickAiProvider = async (): Promise<{ id: string; model: string } | null> => {
    const providers = await window.marko.aiProviders();
    // First pass: cloud providers that have a key.
    for (const p of providers) {
      if (!p.needsKey) continue;
      const has = await window.marko.aiHasKey(p.id);
      if (has) return { id: p.id, model: p.defaultModel };
    }
    // Second pass: any local provider.
    for (const p of providers) {
      if (!p.needsKey) return { id: p.id, model: p.defaultModel };
    }
    return null;
  };

  const runAi = async () => {
    const ptyId = ptyIdRef.current;
    const term = xtermRef.current;
    const prompt = aiPrompt.trim();
    if (!prompt || !ptyId || !term || aiBusy) return;
    setAiBusy(true);
    setAiError(null);

    const provider = await pickAiProvider();
    if (!provider) {
      setAiError('No AI provider configured. Add one in Settings → AI.');
      setAiBusy(false);
      return;
    }

    const reqId = `term-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    aiReqRef.current = reqId;
    let collected = '';
    const offChunk = window.marko.onAiChatChunk(reqId, (chunk) => {
      collected += chunk;
    });
    const offDone = window.marko.onAiChatDone(reqId, (r) => {
      offChunk();
      offDone();
      aiReqRef.current = null;
      setAiBusy(false);
      if (!r.ok) {
        setAiError(r.error ?? 'AI failed');
        return;
      }
      const cmd = sanitizeCommand(collected);
      if (!cmd) {
        setAiError('AI returned an empty command');
        return;
      }
      // Type the command into the PTY (no trailing newline so the user can
      // review and edit before hitting Enter).
      void window.marko.ptyWrite(ptyId, cmd);
      setAiOpen(false);
      setAiPrompt('');
      term.focus();
    });
    const start = await window.marko.aiChatStart(reqId, {
      providerId: provider.id,
      model: provider.model,
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: AI_SYSTEM_PROMPT,
    });
    if (!start.ok) {
      offChunk();
      offDone();
      aiReqRef.current = null;
      setAiBusy(false);
      setAiError(start.error ?? 'Could not start AI request');
    }
  };

  return (
    <div className="terminal-wrap">
      <div ref={hostRef} className="terminal-host" tabIndex={0} />
      {/* Smooth-glide cursor overlay — sibling of terminal-host, not a
          child, because xterm rearranges its host's DOM children
          internally. Positioned absolutely over the host via CSS. */}
      <div ref={cursorRef} className="terminal-glide-cursor" aria-hidden />
      {searchOpen && (
        <div className="terminal-search">
          <input
            ref={searchInputRef}
            className="terminal-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Find in terminal…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) findPrev();
                else findNext();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSearch();
              }
            }}
            spellCheck={false}
          />
          <button className="terminal-search-btn" onClick={findPrev} title="Previous (Shift+Enter)">
            ↑
          </button>
          <button className="terminal-search-btn" onClick={findNext} title="Next (Enter)">
            ↓
          </button>
          <button className="terminal-search-btn" onClick={closeSearch} title="Close (Esc)">
            ×
          </button>
        </div>
      )}

      {aiOpen && (
        <div className="terminal-ai">
          <span className="terminal-ai-icon">✨</span>
          <input
            ref={aiInputRef}
            className="terminal-ai-input"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder={
              aiBusy ? 'Generating…' : 'Describe a command (e.g. "find all .ts files modified in last week")'
            }
            disabled={aiBusy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void runAi();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeAi();
              }
            }}
            spellCheck={false}
          />
          {aiError && <span className="terminal-ai-error">{aiError}</span>}
          <button
            className="terminal-search-btn"
            onClick={() => void runAi()}
            disabled={aiBusy || !aiPrompt.trim()}
            title="Generate (Enter)"
          >
            ↵
          </button>
          <button className="terminal-search-btn" onClick={closeAi} title="Close (Esc)">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
