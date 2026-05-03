import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment, Annotation } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { vim } from '@replit/codemirror-vim';
import { emacs } from '@replit/codemirror-emacs';
import { workspace, useWorkspace, findLeaf, getActiveSession } from '../state/workspace';
import { findLanguage } from '../lib/fileType';
import { useSettings, type EditorKeymap } from '../state/settings';
import { installVimOverrides } from '../lib/vimSetup';
import { glideCursorExtension } from '../lib/glideCursorExtension';
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import { languages } from '@codemirror/language-data';

installVimOverrides();

/** Annotation marking a transaction that was dispatched to apply content from
 *  another editor instance for the same tab. The local update listener uses
 *  this to avoid re-broadcasting the change (which would loop). */
const remoteSync = Annotation.define<boolean>();

/** Minimal-change diff so a remote sync into this editor preserves the local
 *  cursor / selection (CodeMirror remaps selection across `changes` ranges). */
function diffRange(oldStr: string, newStr: string) {
  if (oldStr === newStr) return null;
  let prefix = 0;
  const minLen = Math.min(oldStr.length, newStr.length);
  while (prefix < minLen && oldStr.charCodeAt(prefix) === newStr.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldStr.charCodeAt(oldStr.length - 1 - suffix) ===
      newStr.charCodeAt(newStr.length - 1 - suffix)
  ) {
    suffix++;
  }
  return {
    from: prefix,
    to: oldStr.length - suffix,
    insert: newStr.slice(prefix, newStr.length - suffix),
  };
}

interface Props {
  tabId: string;
  initialValue: string;
  filePath: string | null;
  language?: string;
}

export function CodeEditor({ tabId, initialValue, filePath, language }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The compartment swaps in the chosen modal-keymap extension when the
  // user toggles editorKeymap. Vim/emacs keymaps must come before
  // basicSetup so their bindings take precedence over CM6 defaults.
  const keymapCompartmentRef = useRef<Compartment | null>(null);
  const keymapMode = useSettings().editorKeymap;
  const keymapExtension = (k: EditorKeymap) =>
    k === 'vim' ? vim() : k === 'emacs' ? emacs() : [];

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const langCompartment = new Compartment();
    const keymapCompartment = new Compartment();
    keymapCompartmentRef.current = keymapCompartment;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          keymapCompartment.of(keymapExtension(keymapMode)),
          basicSetup,
          // Theme-driven syntax highlighting — emits `.tok-*` classes so our
          // CSS variables (set per active color theme) drive the colors.
          // Comes after basicSetup so it takes precedence over the default
          // highlight style baked into basicSetup.
          syntaxHighlighting(classHighlighter),
          // Smooth-glide caret — hides CodeMirror's default `.cm-cursor`
          // and renders an overlay div that lerps to the main
          // selection's head each frame. Same easing as the launcher
          // input + terminal cursor.
          glideCursorExtension,
          keymap.of([indentWithTab]),
          EditorView.lineWrapping,
          langCompartment.of([]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            // Skip updates that originated from a remote sync — otherwise we
            // re-broadcast the change and the two panes oscillate.
            if (update.transactions.some((tr) => tr.annotation(remoteSync))) return;
            workspace.updateContent(tabId, update.state.doc.toString());
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;

    // Auto-focus on mount if this tab is active in the focused pane.
    const focusedLeaf = workspace.getFocusedLeaf();
    if (
      focusedLeaf.activeTabId === tabId &&
      !host.contains(document.activeElement)
    ) {
      view.focus();
    }

    const lang = filePath
      ? findLanguage(filePath)
      : language
        ? LanguageDescription.matchLanguageName(languages, language, true)
        : null;
    if (lang) {
      lang.load().then((support) => {
        view.dispatch({ effects: langCompartment.reconfigure(support) });
      });
    }

    return () => {
      view.destroy();
      viewRef.current = null;
      keymapCompartmentRef.current = null;
    };
  }, [tabId, filePath]);

  // Live-toggle the modal keymap on existing editor without remounting.
  useEffect(() => {
    const view = viewRef.current;
    const compartment = keymapCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({
      effects: compartment.reconfigure(keymapExtension(keymapMode)),
    });
  }, [keymapMode]);

  // Cross-pane sync: when the workspace tab.content changes from outside this
  // editor (e.g., the same file open in another pane is being edited), pull
  // the new content in. Annotated as `remoteSync` so the update listener
  // doesn't re-broadcast it.
  const tabContent = useWorkspace((s) => s.tabs.find((t) => t.id === tabId)?.content);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || tabContent === undefined) return;
    const current = view.state.doc.toString();
    const diff = diffRange(current, tabContent);
    if (!diff) return;
    view.dispatch({
      changes: diff,
      annotations: remoteSync.of(true),
    });
  }, [tabContent]);

  // Listen for goto-line events from search results (and any future caller).
  // Retries briefly if the editor view isn't mounted yet — the event often
  // fires moments after `openFileFromPath` triggered our mount.
  useEffect(() => {
    if (!filePath) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string; line?: number };
      if (!detail || detail.path !== filePath || !detail.line) return;
      const tryJump = (attempt = 0) => {
        const view = viewRef.current;
        if (!view) {
          if (attempt < 12) setTimeout(() => tryJump(attempt + 1), 50);
          return;
        }
        const total = view.state.doc.lines;
        const lineNum = Math.max(1, Math.min(detail.line!, total));
        const pos = view.state.doc.line(lineNum);
        view.dispatch({
          selection: { anchor: pos.from, head: pos.from },
          effects: EditorView.scrollIntoView(pos.from, { y: 'center' }),
        });
        view.focus();
      };
      tryJump();
    };
    window.addEventListener('marko:goto-line', handler);
    return () => window.removeEventListener('marko:goto-line', handler);
  }, [filePath]);

  const focusToken = useWorkspace((s) => s.focusToken);
  const isActive = useWorkspace((s) => {
    const session = getActiveSession(s);
    const focused = findLeaf(session.root, session.focusedLeafId);
    return focused?.activeTabId === tabId;
  });
  const seenToken = useRef(focusToken);
  useEffect(() => {
    if (focusToken === seenToken.current) return;
    seenToken.current = focusToken;
    if (!isActive) return;
    if (hostRef.current?.contains(document.activeElement)) return;
    viewRef.current?.focus();
  }, [focusToken, isActive]);

  return <div ref={hostRef} className="codemirror-host" />;
}
