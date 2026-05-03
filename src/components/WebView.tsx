import { useEffect, useRef, useState } from 'react';
import {
  useWorkspace,
  workspace,
  findLeaf,
  getActiveSession,
  subscribeWorkspace,
} from '../state/workspace';
import { normalizeUrl } from '../lib/actions';
import { uiBus } from '../lib/uiBus';
import { useGlideCaret } from '../lib/useGlideCaret';

/** Type of the Electron `<webview>` element with the methods we use.
 *  React's typings don't model the custom element, so we cast through
 *  this shape. */
type WebviewEl = HTMLElement & {
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  loadURL(u: string): void;
  getURL(): string;
  executeJavaScript(code: string): Promise<unknown>;
};

/** Body-level overlay container that holds every web tab's <webview>.
 *  Reparenting an Electron <webview> between DOM nodes destroys the
 *  guest WebContents (page goes blank for ~1min while it re-attaches),
 *  so we never reparent. The webview is appended once into this
 *  container and absolutely-positioned to overlay whatever pane slot
 *  the React tree currently shows it in. Position is synced every
 *  animation frame from the slot's bounding rect.
 *
 *  z-index is low (1) so modals/palettes (z-index 999+) layer above. */
let webviewOverlay: HTMLDivElement | null = null;
function getWebviewOverlay(): HTMLDivElement {
  if (!webviewOverlay || !webviewOverlay.isConnected) {
    webviewOverlay = document.createElement('div');
    webviewOverlay.style.cssText =
      'position:fixed; top:0; left:0; width:0; height:0; pointer-events:none; z-index:1;';
    webviewOverlay.className = 'webview-overlay-root';
    document.body.appendChild(webviewOverlay);
  }
  return webviewOverlay;
}

/** Persistent <webview> element keyed by tabId — lives in the overlay
 *  container for the lifetime of the tab. Destroyed only when the tab
 *  itself is closed. */
const webviewSessions = new Map<string, WebviewEl>();
/** The currently-rendered React "slot" for each tab (the placeholder
 *  div inside the pane). Updated on mount; cleared on unmount. */
const slotByTab = new Map<string, HTMLElement>();
/** Per-tab position-sync loop. Started on first session creation and
 *  cancelled when the session is destroyed. Runs once per frame and
 *  is essentially free per tab (a getBoundingClientRect + a few style
 *  writes). */
const stopByTab = new Map<string, () => void>();

let webviewCleanupSubscribed = false;
function ensureWebviewCleanupSubscribed() {
  if (webviewCleanupSubscribed) return;
  webviewCleanupSubscribed = true;
  let tracked = new Set<string>();
  subscribeWorkspace(() => {
    const tabs = workspace.getState().tabs;
    const currentIds = new Set(
      tabs.filter((t) => t.kind === 'web').map((t) => t.id),
    );
    for (const id of tracked) {
      if (!currentIds.has(id)) destroyWebviewSession(id);
    }
    tracked = currentIds;
  });
}
function destroyWebviewSession(tabId: string) {
  stopByTab.get(tabId)?.();
  stopByTab.delete(tabId);
  slotByTab.delete(tabId);
  const el = webviewSessions.get(tabId);
  if (el) el.remove();
  webviewSessions.delete(tabId);
}
function startPositionLoop(tabId: string) {
  if (stopByTab.has(tabId)) return;
  let cancelled = false;
  const tick = () => {
    if (cancelled) return;
    const wv = webviewSessions.get(tabId);
    if (!wv) return;
    const slot = slotByTab.get(tabId);
    if (slot && slot.isConnected) {
      const r = slot.getBoundingClientRect();
      // A slot inside a `display:none` editor-host (inactive tab in
      // the same leaf) reports 0×0. Park the webview offscreen but
      // KEEP it visible — `display:none` on the webview itself would
      // pause Chromium and stop audio playback.
      if (r.width <= 0 || r.height <= 0) {
        wv.style.top = '-99999px';
        wv.style.left = '-99999px';
        wv.style.width = '800px';
        wv.style.height = '600px';
      } else {
        wv.style.top = `${r.top}px`;
        wv.style.left = `${r.left}px`;
        wv.style.width = `${r.width}px`;
        wv.style.height = `${r.height}px`;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  stopByTab.set(tabId, () => { cancelled = true; });
}
function getOrCreateWebviewElement(tabId: string, url: string): WebviewEl {
  const existing = webviewSessions.get(tabId);
  if (existing) return existing;
  const wv = document.createElement('webview') as WebviewEl;
  wv.setAttribute('src', url);
  wv.setAttribute('allowpopups', 'true');
  wv.setAttribute('webpreferences', 'contextIsolation=yes');
  wv.className = 'webview-frame';
  // Absolute positioning inside the fixed overlay → free-floating
  // rectangle that we sync to the slot's bounding rect each frame.
  wv.style.cssText =
    'position:absolute; top:-99999px; left:-99999px; width:800px; height:600px; pointer-events:auto; background:white; border:0;';
  getWebviewOverlay().appendChild(wv);
  webviewSessions.set(tabId, wv);
  startPositionLoop(tabId);
  return wv;
}

interface Props {
  tabId: string;
  url: string;
}

export function WebView({ tabId, url }: Props) {
  const wvRef = useRef<WebviewEl | null>(null);
  const frameHostRef = useRef<HTMLDivElement | null>(null);

  const [addressBar, setAddressBar] = useState(url);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const { mirrorRef: addrMirrorRef, caretRef: addrCaretRef, bumpInput: addrBump, recompute: addrRecompute } =
    useGlideCaret(addressRef, addressBar);
  const isActive = useWorkspace((s) => {
    const session = getActiveSession(s);
    const focused = findLeaf(session.root, session.focusedLeafId);
    return focused?.activeTabId === tabId;
  });

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

  // Cmd+R: refresh just this page, never the whole app. Only the active
  // web tab reacts; other tab kinds let the bus event fall on the floor.
  useEffect(() => {
    if (!isActive) return;
    return uiBus.on('reload-page', () => {
      try {
        wvRef.current?.reload();
      } catch {
        // webview not yet attached
      }
    });
  }, [isActive]);

  // History navigation triggers — fire from any of three sources:
  //   1. MX-style mouse side buttons (button 3 / 4) outside the webview
  //   2. Cmd+[ / Cmd+] (macOS browser-history shortcut)
  //   3. The toolbar's chevron buttons (wired below in the JSX)
  // Most users with Logitech mice on macOS have the side buttons
  // mapped to Cmd+[ / Cmd+] by the Options+ driver, so the keyboard
  // path is the one that usually fires. The mouse-button path covers
  // people with raw button-3/4 mappings and clicks on the toolbar.
  useEffect(() => {
    if (!isActive) return;
    const navigate = (delta: -1 | 1) => {
      const wv = wvRef.current;
      if (!wv) return;
      try {
        if (delta < 0 && wv.canGoBack()) wv.goBack();
        else if (delta > 0 && wv.canGoForward()) wv.goForward();
      } catch {
        // webview detached
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      // Only the active web tab navigates — the isActive guard above
      // already restricts the listener to one component instance.
      e.preventDefault();
      navigate(e.button === 3 ? -1 : 1);
    };
    const onKey = (e: KeyboardEvent) => {
      // Cmd+[ / Cmd+] only — must be the modifier-only shortcut, not
      // Shift+Cmd+[ (used for tab cycling) or any other combo.
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      // Don't hijack the address bar's own field shortcuts — leaving
      // the keystroke alone there lets users navigate text selection
      // with arrow keys etc. without competing.
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      if (e.key === '[') {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === ']') {
        e.preventDefault();
        navigate(1);
      }
    };
    window.addEventListener('mousedown', onMouse);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouse);
      window.removeEventListener('keydown', onKey);
    };
  }, [isActive]);

  // Register this slot as the position target for the tab's webview.
  // The actual <webview> lives in webviewSessions / overlay root, never
  // moves between DOM parents — a per-frame loop keeps it positioned
  // over our slot. This avoids Electron's "guest reload on reparent"
  // pain (page goes blank for ~1min when <webview> is removed and
  // re-added to the document).
  useEffect(() => {
    const slot = frameHostRef.current;
    if (!slot) return;
    ensureWebviewCleanupSubscribed();
    const wv = getOrCreateWebviewElement(tabId, url);
    slotByTab.set(tabId, slot);
    wvRef.current = wv;
    // Re-mount of an already-loaded webview: sync UI state from the
    // live element so the address bar / nav buttons aren't stale.
    try {
      const live = wv.getURL();
      if (live) {
        setCurrentUrl(live);
        setAddressBar(live);
        setCanBack(wv.canGoBack());
        setCanForward(wv.canGoForward());
        setLoading(false);
      }
    } catch {
      /* guest not yet attached */
    }
    return () => {
      // Only clear the slot if it's still ours — a remount may have
      // already swapped it. Don't stop the position loop or remove
      // the webview; the next mount picks up where we left off.
      if (slotByTab.get(tabId) === slot) slotByTab.delete(tabId);
      wvRef.current = null;
    };
  }, [tabId]);

  useEffect(() => {
    const wv = wvRef.current;
    if (!wv) return;
    const sync = () => {
      try {
        setCanBack(wv.canGoBack());
        setCanForward(wv.canGoForward());
        const u = wv.getURL();
        setCurrentUrl(u);
        setAddressBar(u);
        // Persist the navigated URL back to the tab so a restart picks
        // up where the user left off, not where they started.
        const cur = workspace.getState().tabs.find((t) => t.id === tabId);
        if (cur && u && cur.filePath !== u) {
          workspace.setState((prev) => ({
            tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, filePath: u } : t)),
          }));
        }
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
    // Capture the page-declared favicon URL and stash it on the tab.
    // Pages emit this event for any <link rel="icon"> they ship; we
    // pick the first (most-relevant) entry. The TabBar reads tab.favicon
    // and prefers it over the blunt /favicon.ico probe.
    const onFavicon = (e: any) => {
      const urls: string[] | undefined = e?.favicons;
      const url = urls && urls.length > 0 ? urls[0] : null;
      if (!url) return;
      workspace.setState((prev) => ({
        tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, favicon: url } : t)),
      }));
    };
    const onMediaPlay = () => workspace.setTabPlaying(tabId, true);
    const onMediaPause = () => workspace.setTabPlaying(tabId, false);
    // The <webview> tag runs in its own process, so click events inside
    // it never bubble to the parent React tree — meaning Pane's
    // onMouseDown can't focus this leaf when the user clicks INTO the
    // webpage. Webview's 'focus' event fires whenever the embedded page
    // takes focus (clicks, tabs, programmatic focus), and that's the
    // hook we use to flip the focused leaf.
    const onFocus = () => workspace.setActiveTab(tabId);

    // Mouse-button history navigation. Mousedown events fire inside
    // the guest's Chromium process and never bubble to our renderer,
    // so the host-window listener can't see them. Inject a tiny
    // capturing listener into the guest itself that maps button 3/4
    // (raw MX side buttons) to history.back/forward. dom-ready fires
    // on every navigation, so the script is re-injected after each
    // page load; the __markoNavBound flag keeps it from double-
    // binding within a single document.
    const onDomReady = () => {
      void wv.executeJavaScript(`
        (function () {
          if (window.__markoNavBound) return;
          window.__markoNavBound = true;
          // Only fire on bare back/forward mouse-button presses. If
          // any modifier is held, bail — Logitech Options+ profiles
          // can synthesize both a keystroke (Cmd+Shift+[) and the
          // underlying button event for the same press, and we don't
          // want both "cycle tab" and "go back" firing at once.
          window.addEventListener('mousedown', function (e) {
            if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.button === 3) { e.preventDefault(); window.history.back(); }
            else if (e.button === 4) { e.preventDefault(); window.history.forward(); }
          }, true);
          window.addEventListener('auxclick', function (e) {
            if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.button === 3 || e.button === 4) e.preventDefault();
          }, true);
        })();
      `);
    };

    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    wv.addEventListener('did-navigate', sync);
    wv.addEventListener('did-navigate-in-page', sync);
    wv.addEventListener('page-title-updated', onTitle);
    wv.addEventListener('page-favicon-updated', onFavicon);
    wv.addEventListener('media-started-playing', onMediaPlay);
    wv.addEventListener('media-paused', onMediaPause);
    wv.addEventListener('focus', onFocus);
    wv.addEventListener('dom-ready', onDomReady);
    return () => {
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
      wv.removeEventListener('did-navigate', sync);
      wv.removeEventListener('did-navigate-in-page', sync);
      wv.removeEventListener('page-title-updated', onTitle);
      wv.removeEventListener('page-favicon-updated', onFavicon);
      wv.removeEventListener('media-started-playing', onMediaPlay);
      wv.removeEventListener('media-paused', onMediaPause);
      wv.removeEventListener('focus', onFocus);
      wv.removeEventListener('dom-ready', onDomReady);
      workspace.setTabPlaying(tabId, false);
    };
  }, [tabId]);

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
        <div className="webview-address-wrap">
          <input
            ref={addressRef}
            className="webview-address"
            value={addressBar}
            onChange={(e) => {
              addrBump();
              setAddressBar(e.target.value);
            }}
            onKeyDown={(e) => {
              addrBump();
              if (e.key === 'Enter') {
                e.preventDefault();
                loadAddress();
              }
            }}
            onKeyUp={addrRecompute}
            onClick={addrRecompute}
            spellCheck={false}
          />
          <span ref={addrMirrorRef} className="webview-address-mirror" aria-hidden />
          <div ref={addrCaretRef} className="webview-address-caret" aria-hidden />
        </div>
      </div>
      {/* The actual <webview> lives in webviewSessions (module scope) and
          is appended into this host imperatively by the mount effect.
          Lifting it out of React's tree lets it survive component
          unmounts during pane splits without reloading. */}
      <div ref={frameHostRef} className="webview-frame-host" />
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
