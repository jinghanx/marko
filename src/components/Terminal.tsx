import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { useWorkspace, workspace, getActiveSession } from '../state/workspace';
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

export function Terminal({ tabId }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);

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

    const ptyId = `pty-${tabId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ptyIdRef.current = ptyId;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: codeFont,
      fontSize: 13,
      lineHeight: 1.2,
      theme: xtermThemeFor(activeTheme),
      scrollback: 10000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);

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

    term.open(host);
    fit.fit();
    xtermRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    const cols = term.cols;
    const rows = term.rows;

    let dispose: (() => void) | null = null;
    let disposeExit: (() => void) | null = null;

    void window.marko
      .ptySpawn(ptyId, { cwd: rootDir ?? undefined, cols, rows })
      .then((r) => {
        if (!r.ok) {
          term.writeln(`\x1b[31mFailed to start shell: ${r.error}\x1b[0m`);
          return;
        }
        dispose = window.marko.onPtyData(ptyId, (data) => term.write(data));
        disposeExit = window.marko.onPtyExit(ptyId, () => {
          term.writeln('\r\n\x1b[2m[shell exited]\x1b[0m');
        });
        // Spawn cwd alone isn't always enough — many users have rc files
        // that `cd $HOME` on shell startup, undoing the cwd we passed.
        // Send an explicit cd after a short delay (long enough for the
        // shell to finish reading rc files but before the user types).
        if (rootDir) {
          const escaped = rootDir.replace(/'/g, `'\\''`);
          setTimeout(() => {
            void window.marko.ptyWrite(ptyId, ` cd '${escaped}' && clear\r`);
          }, 120);
        }
      });

    const onUserInput = term.onData((data) => {
      void window.marko.ptyWrite(ptyId, data);
    });

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
      host.removeEventListener('keydown', onKeyDown);
      ro.disconnect();
      onUserInput.dispose();
      linkDispose.dispose();
      urlLinkDispose.dispose();
      dispose?.();
      disposeExit?.();
      void window.marko.ptyKill(ptyId);
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, [tabId, codeFont, activeTheme]);

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
