import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw';
import type {
  ExcalidrawImperativeAPI,
  AppState,
  BinaryFiles,
} from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { workspace, useWorkspace } from '../state/workspace';
import { useSettings, useActiveTheme } from '../state/settings';
import '@excalidraw/excalidraw/index.css';

interface Props {
  tabId: string;
  initialValue: string;
  filePath: string | null;
}

interface ExcalidrawScene {
  type?: string;
  version?: number;
  elements?: OrderedExcalidrawElement[];
  appState?: Partial<AppState>;
  files?: BinaryFiles;
}

function parseScene(text: string): ExcalidrawScene | null {
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text) as ExcalidrawScene;
  } catch {
    return null;
  }
}

/** Excalidraw whiteboard tab. The scene is serialized as JSON in the tab's
 *  `content` field, so it round-trips through the same save / persistence
 *  pipeline as any text file. We resolve the active theme from settings so
 *  the canvas matches the rest of the app. */
export function ExcalidrawViewer({ tabId, initialValue, filePath }: Props) {
  // Active theme — Excalidraw accepts 'light' | 'dark'. Map system mode to
  // the resolved color scheme.
  const themeMode = useSettings().theme;
  const isDark =
    themeMode === 'dark' ||
    (themeMode === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  // Pull the actual canvas-background color from the active theme so the
  // Excalidraw pasteboard matches Marko's pane bg. We subscribe to
  // useActiveTheme so the color updates the moment the user switches themes.
  const activeTheme = useActiveTheme();
  const canvasBg = activeTheme.bg;

  // Capture initial scene once so Excalidraw owns the doc state after mount.
  // Treat content updates from the workspace (cross-pane sync) like a remote
  // patch — apply via the imperative API rather than remounting.
  const initialScene = useMemo(() => parseScene(initialValue), [initialValue]);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const lastSerialized = useRef<string>(initialValue);

  // Cross-pane sync: pull workspace.tab.content into the canvas if it
  // differs from what we last emitted (i.e. another pane edited it).
  const tabContent = useWorkspace((s) => s.tabs.find((t) => t.id === tabId)?.content);
  useEffect(() => {
    if (tabContent === undefined) return;
    if (tabContent === lastSerialized.current) return;
    const api = apiRef.current;
    if (!api) return;
    const next = parseScene(tabContent);
    if (!next || !next.elements) return;
    api.updateScene({
      elements: next.elements,
      // Same partial-AppState casting story as initialData below.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appState: next.appState as any,
    });
    lastSerialized.current = tabContent;
  }, [tabContent]);

  const onChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      const json = serializeAsJSON(elements, appState, files, 'local');
      if (json === lastSerialized.current) return;
      lastSerialized.current = json;
      workspace.updateContent(tabId, json);
    },
    [tabId],
  );

  // Merge Marko's bg into the appState so the canvas matches the pane on
  // first paint. Per-scene saved colors win if the file already has one.
  const initialData = {
    elements: initialScene?.elements ?? [],
    appState: {
      ...(initialScene?.appState ?? {}),
      viewBackgroundColor:
        initialScene?.appState?.viewBackgroundColor ?? canvasBg,
    },
    files: initialScene?.files,
  };

  // Re-apply on theme switch — calls into the imperative API so the live
  // canvas updates without remounting (which would lose user edits).
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.updateScene({
      appState: {
        viewBackgroundColor: canvasBg,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
  }, [canvasBg]);

  return (
    <div className="excalidraw-pane" title={filePath ?? undefined}>
      <Excalidraw
        // The persisted scene's appState is partial — Excalidraw merges with
        // its own defaults internally. The library's own type is overly
        // strict (e.g. `name: string | null` rather than `| undefined`), so
        // we cast at the prop boundary.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialData={initialData as any}
        excalidrawAPI={(api) => {
          apiRef.current = api;
        }}
        onChange={onChange}
        theme={isDark ? 'dark' : 'light'}
      />
    </div>
  );
}
