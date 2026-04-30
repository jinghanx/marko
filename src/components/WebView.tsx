import { createElement, useEffect, useRef, useState } from 'react';
import { useWorkspace, workspace } from '../state/workspace';
import { normalizeUrl } from '../lib/actions';
import { uiBus } from '../lib/uiBus';

interface Props {
  tabId: string;
  url: string;
}

export function WebView({ tabId, url }: Props) {
  const wvRef = useRef<HTMLElement & {
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    loadURL(u: string): void;
    getURL(): string;
    addEventListener(type: string, listener: (e: any) => void): void;
    removeEventListener(type: string, listener: (e: any) => void): void;
  } | null>(null);

  const [addressBar, setAddressBar] = useState(url);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const isActive = useWorkspace((s) => s.activeTabId === tabId);

  // Cmd+L: only the active web tab responds.
  useEffect(() => {
    if (!isActive) return;
    return uiBus.on('focus-address', () => {
      const el = addressRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
  }, [isActive]);

  useEffect(() => {
    const wv = wvRef.current;
    if (!wv) return;
    const sync = () => {
      try {
        setCanBack(wv.canGoBack());
        setCanForward(wv.canGoForward());
        setCurrentUrl(wv.getURL());
        setAddressBar(wv.getURL());
      } catch {
        // webview not yet attached
      }
    };
    const onStart = () => setLoading(true);
    const onStop = () => {
      setLoading(false);
      sync();
    };
    const onTitle = (e: any) => setPageTitle(e.title);

    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    wv.addEventListener('did-navigate', sync);
    wv.addEventListener('did-navigate-in-page', sync);
    wv.addEventListener('page-title-updated', onTitle);
    return () => {
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
      wv.removeEventListener('did-navigate', sync);
      wv.removeEventListener('did-navigate-in-page', sync);
      wv.removeEventListener('page-title-updated', onTitle);
    };
  }, []);

  // Sync the title back into the tab.
  useEffect(() => {
    if (!pageTitle) return;
    const cur = workspace.getState().tabs.find((t) => t.id === tabId);
    if (!cur || cur.title === pageTitle) return;
    workspace.setState((prev) => ({
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, title: pageTitle } : t)),
    }));
  }, [pageTitle, tabId]);

  const loadAddress = () => {
    const next = normalizeUrl(addressBar);
    wvRef.current?.loadURL(next);
  };

  return (
    <div className="webview-host">
      <div className="webview-toolbar">
        <button
          className="webview-btn"
          disabled={!canBack}
          onClick={() => wvRef.current?.goBack()}
          title="Back"
          aria-label="Back"
        >
          <Chev dir="left" />
        </button>
        <button
          className="webview-btn"
          disabled={!canForward}
          onClick={() => wvRef.current?.goForward()}
          title="Forward"
          aria-label="Forward"
        >
          <Chev dir="right" />
        </button>
        <button
          className="webview-btn"
          onClick={() => wvRef.current?.reload()}
          title="Reload"
          aria-label="Reload"
        >
          {loading ? '×' : '↻'}
        </button>
        <input
          ref={addressRef}
          className="webview-address"
          value={addressBar}
          onChange={(e) => setAddressBar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              loadAddress();
            }
          }}
          spellCheck={false}
        />
      </div>
      {/* `webview` is an Electron-specific element; React's typings don't
          model its DOM attributes, so we cast props through React.createElement. */}
      {createElement('webview', {
        ref: wvRef,
        src: url,
        className: 'webview-frame',
        webpreferences: 'contextIsolation=yes',
      })}
      <div className="webview-status">{currentUrl}</div>
    </div>
  );
}

function Chev({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
      <path
        d={dir === 'left' ? 'M10 3 L5 8 L10 13' : 'M6 3 L11 8 L6 13'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
