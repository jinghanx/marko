# Marko

> editor ✦ finder ✦ browser ✦ terminal — one window for everything

Marko is a macOS workspace app that combines a WYSIWYG markdown editor, a Finder-style folder browser, an embedded code editor, an embedded web browser, and a real terminal — all driven by keyboard shortcuts and a recursive split-pane layout.

![Marko app icon](build/icon.png)

## Why

The five tools above usually live in five separate apps. Switching between them — Cmd+Tab, find the window, click around — costs flow. Marko collapses them into a single window that opens to the right tool based on what you're touching:

- Click a Markdown file → WYSIWYG editor
- Click a code file → CodeMirror with theme-aware syntax highlighting
- Click an image → image viewer with thumbnails and a zoom toggle
- Click a folder → Finder-style grid with multi-select, drag-select, sections, copy/cut/paste
- Type a URL in `⌘T` → embedded webview tab
- Type `terminal` in `⌘T` → real shell tab via `node-pty`
- Press `⌘\\` → split right; `⌘=` → split down; nest as deep as you want

Everything is one keystroke away.

## Features at a glance

### Editing
- **Markdown WYSIWYG** via Milkdown Crepe — slash commands, drag handles, tables, code blocks, math, GFM
- **Code editor** via CodeMirror 6 with auto-detected language for 30+ languages
- **Vim mode** toggle for code files (Preferences → Editor → Vim mode)
- **Color themes**: 5 light + 10 dark, including GitHub, Tokyo Night, Catppuccin, Dracula, Gruvbox, One Dark, Nord, Solarized, Rosé Pine
- Token colors and terminal palette derived from each theme's ANSI palette so everything stays coherent

### Workspace
- **Sidebar file tree** with keyboard navigation, lazy loading, F2 rename, ⌘⌫ trash, drag-drop create
- **Workspace bookmarks** — pin folders you switch between often (sidebar dropdown)
- **`⌘P` quick-open** — fzf-powered fuzzy file search scoped to the current workspace
- **`⌘T` go-to** — autocompleting path input that also handles URLs and commands (`terminal` etc.)
- **Folder view** — Finder-style grid with sort options (name/date/size/kind), section headers, viewport-locked drag-select, ⌘C/⌘X/⌘V, Quick Look (Space)
- **Outline pane** — adapts per tab kind:
  - Markdown → clickable heading list
  - Code → live minimap with viewport indicator
  - Folder → file/folder preview pane (thumbnail, size, dates, text peek)

### Panes & tabs
- **Recursive split panes** — split horizontally (`⌘\\`) and vertically (`⌘=`) as deeply as you want
- **Pane focus** with `⌘\``  cycle, draggable splitters
- **Tab bar per pane**, tab kinds visually differentiated (folder, web, terminal, markdown, code, image, binary)
- **Right-click any tab** for close-others / close-to-right / copy path / reveal in Finder

### Embedded apps
- **Web tabs** with back/forward, reload, address bar (⌘L); typing a URL in `⌘T` opens here
- **Terminal tabs** running your real `$SHELL` via `node-pty`, themed to match the active color scheme
- **Process viewer** (`⌘Y`) — htop-style with live CPU bars, memory bar, fuzzy filter, process kill

### macOS niceties
- Hidden-inset titlebar, traffic lights inset, draggable region
- Native menus with full keyboard accelerators
- Quick Look on Space, Reveal in Finder, Open in Default App
- Dock icon honors the project's custom Marko icon

## Keyboard shortcuts

A full cheatsheet is shown on the welcome screen. Highlights:

| Action | Shortcut |
|---|---|
| Quick open file | `⌘P` |
| Go to path / command | `⌘T` |
| New file (with type picker) | `⌘N` |
| Save / Save As | `⌘S` / `⌘⇧S` |
| Close tab | `⌘W` |
| Previous / next tab | `⌘⇧[` / `⌘⇧]` |
| Split right / down | `⌘\\` / `⌘=` |
| Next / previous pane | `⌘\`` / `⌘⇧\`` |
| Toggle sidebar | `⌘E` |
| Toggle outline | `⌘⇧\\` |
| Process viewer | `⌘Y` |
| Preferences | `⌘,` |
| Quick Look (folder view) | `Space` |
| Move to Trash | `⌘⌫` |

## Stack

- **Electron 41** — application shell, sandboxed renderer
- **React 19 + TypeScript** — UI
- **Vite 8** with `vite-plugin-electron` — bundler & dev HMR
- **Milkdown Crepe 7** — markdown WYSIWYG (ProseMirror under the hood)
- **CodeMirror 6** + `@codemirror/language-data` — code editor with 30+ language packs
- **xterm.js + node-pty** — embedded terminal
- **fzf** — fuzzy search for the file palette and process viewer
- **electron-builder** — `.dmg` packaging

## Develop

```bash
npm install

# In dev, the bundled Electron's app menu shows "Electron" by default —
# this script patches the dev bundle to show "Marko" (one-time, harmless).
npm run rename:dev-electron

npm run dev  # starts Vite + Electron with HMR
```

## Build a release

```bash
npm run package:mac        # both arm64 and x64 .dmg
npm run package:mac:arm    # Apple Silicon only
npm run package:mac:intel  # Intel only
```

Output lands in `release/`. The DMG is unsigned, so first-launch users right-click → Open to bypass Gatekeeper. Code-signing requires an Apple Developer cert.

## Architecture

```
electron/
  main.ts          # window, menus, IPC handlers (file IO, dir walk,
                   # PTY, image load, image cache, system stats…)
  preload.ts       # contextBridge — exposes typed `window.marko` API

src/
  App.tsx          # layout shell, menu/uiBus wiring, modal mux
  state/
    workspace.ts   # binary pane tree, tabs, focus tokens, reveal state
    settings.ts    # persisted preferences + theme application
  components/
    Sidebar.tsx          # file tree with keyboard nav, context menus
    Pane.tsx             # focused-state pane wrapper
    PaneNode.tsx         # recursive split renderer
    TabBar.tsx           # per-pane tab bar with kind icons + ctx menu
    EditorPane.tsx       # dispatches by tab kind
    CrepeEditor.tsx      # Milkdown markdown editor + drag preview
    CodeEditor.tsx       # CodeMirror w/ vim, theme-driven syntax colors
    FolderView.tsx       # Finder-style grid (sort, sections, multi-select)
    FolderPreview.tsx    # Outline-pane preview for folder tabs
    Outline.tsx          # heading list / minimap / folder preview
    CodeMinimap.tsx      # bar-based code minimap
    ImageViewer.tsx      # fit/100% image tab
    WebView.tsx          # embedded webview with toolbar
    Terminal.tsx         # xterm.js + node-pty
    ProcessViewer.tsx    # htop-style ⌘Y modal
    FilePalette.tsx      # ⌘P fzf file finder
    PathInput.tsx        # ⌘T path/URL/command input w/ autocomplete
    NewFilePicker.tsx    # ⌘N file-type picker
    SettingsModal.tsx    # ⌘, preferences
    WelcomeScreen.tsx    # ASCII logo + shortcut cheatsheet
  lib/
    themes.ts            # 15 built-in color themes + ANSI palettes
    editorTheme.ts       # Crepe theme variants (Frame/Classic/Nord)
    fileType.ts          # extension → kind detection + language matching
    actions.ts           # open / save / close orchestration
    fileClipboard.ts     # in-app cut/copy/paste store
    blockDragPreview.ts  # live block-rearrange preview during drag
    vimSetup.ts          # vim Ctrl-D/U overrides
    uiBus.ts             # cross-component event bus
  styles/global.css      # CSS variables, theme tokens, all layout
```

The pane tree is a binary tree of `LeafNode` (carries `tabIds[]` + `activeTabId`) and `SplitNode` (`direction` + `ratio` + two children). All UI is rendered by recursing through this tree. Tabs are stored once in a flat `tabs` array; leaves hold IDs into it, so the same file open in multiple panes shares one buffer.

## License

MIT — do whatever you want with it.
