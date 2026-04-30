# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Marko is an Electron desktop app for macOS that combines a markdown editor (Milkdown Crepe), a code editor (CodeMirror 6), a Finder-style folder browser, an embedded webview, and a real terminal (xterm.js + node-pty) — all inside a recursive split-pane layout. It is keyboard-driven and theme-aware. The README has the full feature/shortcut list.

A separate static landing page lives in `landing/` (plain HTML/CSS, deployed to Vercel from that subdirectory).

## Common commands

| | |
|---|---|
| `npm run dev` | Vite + Electron with HMR. Renderer hot-reloads instantly. Main-process and preload changes rebuild but do **not** auto-restart Electron — `⌘Q` and rerun `npm run dev` to pick up `electron/main.ts` or `electron/preload.ts` changes. |
| `npm run rename:dev-electron` | One-time patch of `node_modules/electron/dist/Electron.app/Contents/Info.plist` so the dev menu bar reads "Marko" instead of "Electron". Re-run after any `npm install` that reinstalls Electron. |
| `npm run build` | `tsc -p tsconfig.node.json` then `vite build`. Outputs to `dist/` (renderer) and `dist-electron/` (main + preload). |
| `npm run package:mac` | Build + `electron-builder --mac --arm64 --x64`. Outputs `release/Marko-X.Y.Z-arm64.dmg` and `release/Marko-X.Y.Z.dmg`. |
| `npm run package:mac:arm` / `:intel` | Single-arch builds (faster). |
| `npx tsc --noEmit -p tsconfig.json` | Typecheck the renderer. No test framework is configured. |
| `npx tsc --noEmit -p tsconfig.node.json` | Typecheck `electron/` + `vite.config.ts`. |

There are **no tests** and **no linter** configured.

## High-level architecture

### Process split

- `electron/main.ts` — Electron main process. Owns: window creation, native menus + accelerators, all filesystem IO, PTY lifecycle (`node-pty`), system stats (for the process viewer), Quick Look, image loading (returns base64 data URLs), recursive directory walks for the file palette.
- `electron/preload.ts` — Defines `window.marko`, the only renderer→main bridge. Every IPC handler in `main.ts` is mirrored here as a typed method. **When you add a new IPC handler, you must update both `preload.ts` and `src/types/marko.d.ts`** — they're not auto-generated.
- `src/` — React renderer.

The renderer never touches `node:fs` or other Node modules; it goes through `window.marko`. This is enforced by `contextIsolation: true` and `nodeIntegration: false` in main.

### Renderer state model

Two singleton stores under `src/state/`, both exposed as plain `useSyncExternalStore` hooks (no Redux/Zustand/Jotai):

- `state/workspace.ts` — the binary **pane tree** (`PaneTree = LeafNode | SplitNode`), the flat `tabs[]` array, `focusedLeafId`, `rootDir`, plus signal fields (`focusToken`, `revealPath` + `revealToken`, `folderSelection`). Tabs live once in `tabs[]`; leaves hold IDs into it, so the same file open in two panes shares one buffer. The recursive tree means split panes can nest in any direction. **Important**: tab IDs are not unique to a leaf — call `closeTabInLeaf(leafId, tabId)` (not `closeTab`) when the operation must stay scoped to one pane (the tab-bar close button is one such case).
- `state/settings.ts` — persisted preferences in `localStorage` (key `marko:settings`). On every update, applies CSS variables to `document.documentElement` (`applyToDom`) and active color theme via `applyThemeToDom`. Initial load is synchronous.

### Pane / tab rendering

`App.tsx` renders one `<PaneNode>` against `workspace.root`. `PaneNode` recursively walks the tree: a `LeafNode` renders `<Pane>` (which contains `<TabBar>` + `<EditorPane>`), a `SplitNode` renders a flex container with two `<PaneNode>`s and a draggable `<Splitter>` between them.

`EditorPane` dispatches by `tab.kind` (`markdown | code | image | binary | folder | web | terminal`) to the right component. The Outline pane (right side, toggle `⌘⇧\\`) similarly dispatches: heading list for markdown, `<CodeMinimap>` for code, `<FolderPreview>` for folder. To add a new tab kind: extend `TabKind` in `state/workspace.ts`, add a case in `EditorPane.tsx`, add a glyph in `TabBar.tsx`, add detection logic in `lib/fileType.ts`/`lib/actions.ts`.

### Theming

Color themes are pure data (`src/lib/themes.ts`). Each theme defines an app palette + 16-color ANSI palette. `applyThemeToDom(theme)` writes everything as CSS variables — including syntax tokens (`--tok-keyword` etc.) **derived from the theme's ANSI palette** so code highlighting stays visually coherent with the terminal palette. Settings hold a `lightThemeId` and `darkThemeId`; the active one is picked by the app's `theme: 'system' | 'light' | 'dark'` setting + system color-scheme media query.

CodeMirror's `defaultHighlightStyle` is bypassed by adding `syntaxHighlighting(classHighlighter)` after `basicSetup` in `CodeEditor.tsx` — this emits `tok-*` classes instead of inline colors, letting our CSS vars drive token colors.

### Cross-component events

`src/lib/uiBus.ts` is a tiny string-typed pub/sub used for menu-driven events that need to reach deeper components (e.g., the embedded webview's `Cmd+L` → focus address bar). Most communication still goes through workspace state, but uiBus is the right tool when the trigger is a top-level menu accelerator that targets a specific child component.

### Native binding caveats

- `node-pty` ships a prebuilt native binding + a `spawn-helper` executable. npm sometimes strips the +x bit during install. `main.ts` runs `ensurePtyHelperExecutable()` on startup to chmod it `0o755`.
- `node-pty` is marked `external` in `vite.config.ts`'s main-process build (Vite shouldn't bundle a native module).
- The preload outputs `.cjs` (not `.mjs`) because Electron's preload loader prefers CommonJS. Don't change this.

### macOS specifics

- The dev Electron's app menu shows "Electron" unless you run `npm run rename:dev-electron`. Production `electron-builder` builds get the right name automatically.
- Port 5000 is occupied by macOS AirPlay Receiver — don't suggest it for any local server.
- `qlmanage -p` is used for Quick Look; macOS only.
- Icon at `build/icon.png` (1024×1024 RGBA) is the source for both the dev dock icon and the production `.icns` (electron-builder converts).

## Ports of call when extending

- New keyboard shortcut: `electron/main.ts` (menu accelerator) → `App.tsx` (`window.marko.onMenu(...)` listener) → call workspace/uiBus action.
- New file type: `lib/fileType.ts` (detect kind) → `lib/actions.ts` (`openFileFromPath` dispatch) → `state/workspace.ts` (`TabKind`) → `EditorPane.tsx` (render the right component).
- New IPC: handler in `electron/main.ts` → expose in `electron/preload.ts` → declare in `src/types/marko.d.ts` → call from a renderer module.
- New color theme: append to `LIGHT_THEMES` or `DARK_THEMES` in `src/lib/themes.ts`; everything else (settings dropdown, terminal palette, syntax tokens) picks it up automatically.

## Things to know about the conversation context

- Code-signing for the .dmg is **disabled** (`mac.identity: null` in `package.json`'s `build` block). Users hit a Gatekeeper warning on first launch. Don't enable signing without an Apple Developer cert in env.
- The GitHub repo is `jinghanx/marko` (public). Releases pattern: `gh release create vX.Y.Z release/*.dmg`. The landing page links to `releases/latest/download/Marko-X.Y.Z-{arm64,}.dmg` — keep DMG asset filenames consistent across releases or update the landing page.
