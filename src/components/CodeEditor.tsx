import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { vim } from '@replit/codemirror-vim';
import { workspace, useWorkspace, findLeaf } from '../state/workspace';
import { findLanguage } from '../lib/fileType';
import { useSettings } from '../state/settings';
import { installVimOverrides } from '../lib/vimSetup';
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import { languages } from '@codemirror/language-data';

installVimOverrides();

interface Props {
  tabId: string;
  initialValue: string;
  filePath: string | null;
  language?: string;
}

export function CodeEditor({ tabId, initialValue, filePath, language }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const vimCompartmentRef = useRef<Compartment | null>(null);
  const vimMode = useSettings().vimMode;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const langCompartment = new Compartment();
    const vimCompartment = new Compartment();
    vimCompartmentRef.current = vimCompartment;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          // vim must come before basicSetup so its keymap takes precedence
          vimCompartment.of(vimMode ? vim() : []),
          basicSetup,
          // Theme-driven syntax highlighting — emits `.tok-*` classes so our
          // CSS variables (set per active color theme) drive the colors.
          // Comes after basicSetup so it takes precedence over the default
          // highlight style baked into basicSetup.
          syntaxHighlighting(classHighlighter),
          keymap.of([indentWithTab]),
          EditorView.lineWrapping,
          langCompartment.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              workspace.updateContent(tabId, update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;

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
      vimCompartmentRef.current = null;
    };
  }, [tabId, filePath]);

  // Live-toggle vim mode on existing editor.
  useEffect(() => {
    const view = viewRef.current;
    const compartment = vimCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({
      effects: compartment.reconfigure(vimMode ? vim() : []),
    });
  }, [vimMode]);

  const focusToken = useWorkspace((s) => s.focusToken);
  const isActive = useWorkspace((s) => {
    const focused = findLeaf(s.root, s.focusedLeafId);
    return focused?.activeTabId === tabId;
  });
  const seenToken = useRef(focusToken);
  useEffect(() => {
    if (focusToken === seenToken.current) return;
    seenToken.current = focusToken;
    if (!isActive) return;
    viewRef.current?.focus();
  }, [focusToken, isActive]);

  return <div ref={hostRef} className="codemirror-host" />;
}
