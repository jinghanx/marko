import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useWorkspace, workspace, getActiveSession } from '../state/workspace';
import { useActiveTheme, useSettings } from '../state/settings';
import { xtermThemeFor } from '../lib/themes';
import { openFileFromPath } from '../lib/actions';
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
    const webLinks = new WebLinksAddon((event, uri) => {
      // Cmd-click (or shift-click) only — single click should not steal focus
      // from someone selecting text. xterm passes the original mouse event.
      if (event && (event.metaKey || event.ctrlKey)) {
        void window.marko.openDefault(uri).catch(() => {
          // Fall through to default browser open via shell.
        });
      }
    });
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(webLinks);

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
        let match: RegExpExecArray | null;
        FILE_PATH_RE.lastIndex = 0;
        while ((match = FILE_PATH_RE.exec(text)) !== null) {
          const matchedText = match[0];
          // Drop trivial/false-positive matches: bare extension-only,
          // protocol-prefixed, or anything obviously not a real file.
          if (matchedText.startsWith('http')) continue;
          if (matchedText.length < 3) continue;
          const linePart = match[2] ? parseInt(match[2], 10) : undefined;
          const start = match.index;
          const end = start + matchedText.length;
          links.push({
            range: {
              start: { x: start + 1, y: _lineNum },
              end: { x: end, y: _lineNum },
            },
            text: matchedText,
            activate: () => {
              const pathOnly = match![1];
              const abs = pathOnly.startsWith('/')
                ? pathOnly
                : `${rootDir ?? ''}/${pathOnly}`;
              void window.marko.stat(abs).then((stat) => {
                if (!stat.exists) return;
                if (stat.isDirectory) {
                  // Folder paths could open in folder view — but for
                  // simplicity, just reveal in the tree.
                  workspace.revealInTree(abs);
                  return;
                }
                void openFileFromPath(abs, { focus: true });
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
