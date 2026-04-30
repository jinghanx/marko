import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useWorkspace } from '../state/workspace';
import { useActiveTheme, useSettings } from '../state/settings';
import { xtermThemeFor } from '../lib/themes';
import '@xterm/xterm/css/xterm.css';

interface Props {
  tabId: string;
}

export function Terminal({ tabId }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const rootDir = useWorkspace((s) => s.rootDir);
  const codeFont = useSettings().codeFont;
  const activeTheme = useActiveTheme();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Unique id per mount so leftover IPC events from a torn-down instance
    // can't hit a fresh listener (matters under React StrictMode dev double-mount).
    const ptyId = `pty-${tabId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: codeFont,
      fontSize: 13,
      lineHeight: 1.2,
      theme: xtermThemeFor(activeTheme),
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    xtermRef.current = term;
    fitRef.current = fit;

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

    // Refit on container resize.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        void window.marko.ptyResize(ptyId, term.cols, term.rows);
      } catch {
        // ignore measurement glitches during teardown
      }
    });
    ro.observe(host);

    // Focus the terminal on mount.
    term.focus();

    return () => {
      ro.disconnect();
      onUserInput.dispose();
      dispose?.();
      disposeExit?.();
      void window.marko.ptyKill(ptyId);
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [tabId, codeFont, activeTheme]);

  return <div ref={hostRef} className="terminal-host" />;
}
