# Marko

> One window for everything you do at a desk.

Marko is a macOS workspace app that bundles a markdown editor, a Finder-style folder browser, a code editor, an embedded browser, a real terminal, an AI chat, a full Git client, and a long tail of "exotic" tabs (PDF, CSV, JSON, diff, whiteboard, HTTP client, find-in-files, audio/video, …) into a single keyboard-driven window with recursive split panes and tmux-style sessions.

![Marko app icon](build/icon.png)

## Why

The tools above usually live in fifteen separate apps. Switching between them — Cmd+Tab, find the window, click around — costs flow. Marko collapses them into one window where every surface opens with the same shortcut: **⌘T**, type a hint, hit Enter.

- `⌘T git` → full Git client (status, diff, hunk-stage, line-stage, branches, stashes, tags, history, cherry-pick, fetch/pull/push)
- `⌘T chat` → streaming AI chat (OpenAI / OpenRouter / Anthropic / Ollama / LM Studio / any OpenAI-compatible endpoint)
- `⌘T find` → ripgrep-backed find-in-files
- `⌘T http` → Postman-lite HTTP client
- `⌘T draw` → Excalidraw whiteboard
- `⌘T term`, `⌘T notes`, `⌘T activity`, `⌘T history` … and so on

Splits and sessions live alongside everything: `⌘\` splits right, `⌘=` splits down, `⌘⌥N` opens a new tmux-style session with its own workspace root. The whole layout — sessions, panes, open tabs, scratch buffers — survives restart.

## Global launcher (⌘⌥Space)

A Spotlight/Raycast-style mini-window you can wake from anywhere — even when Marko isn't focused, even when its window is closed.

- **All ⌘T commands** — every Marko command (open terminal, git, chat, search, http, settings, clipboard, downloads, documents, …) with proper per-kind icons.
- **macOS app launcher** — type `chrome` / `slack` / `figma` and press ↵ to launch. Apps in `/Applications`, `~/Applications`, and the system app folders are all indexed.
- **Web search** — anything that doesn't match a command or app falls back to "Search the web for X" using your configured engine (Google · DuckDuckGo · Kagi · Bing · Brave · Custom URL).
- **Inline calculator** — type `1234 * 5678` or `(15 + 5) * 4 / 2`; press ↵ to copy the result to the clipboard. No round-trip to the main app.
- **Keyboard-first** — ↑↓ to navigate, ↵ to run, Tab to extend the input to the highlighted command, Esc to dismiss.

Internal commands wake Marko's main window when needed; external apps and the calculator finish without touching it. Esc dismisses the launcher and returns focus to whatever app you were using before.

## What you get

### 18 tab kinds

| Tab | What it is |
|---|---|
| **Markdown** | Milkdown Crepe WYSIWYG · slash commands · drag handles · GFM tables · math · raw / split / rendered modes |
| **Code** | CodeMirror 6 · 30+ languages · vim & emacs keymaps · cross-pane edit sync · jump-to-line via search results / terminal |
| **Image** | Fit / 100 % toggle · folder thumbnails · Quick Look on Space |
| **Media** | Streaming `<video>` / `<audio>` for mp3 / mp4 / mov / webm · range-request seek · "Now Playing" pill in the titlebar |
| **PDF** | Chromium's built-in PDF plugin · zoom, search, page nav, print, download |
| **CSV / TSV** | Sticky-header table · click-to-sort columns · raw / split / rendered modes |
| **JSON** | Collapsible tree inspector · raw editor · split mode · type-coloured values |
| **Diff** | Unified line diff between any two files · entry from folder view "Compare With…" |
| **Folder** | Finder-style grid · sort / sections · drag-select · drag to move (⌥-drag = copy) · cut / copy / paste · Quick Look · adjustable icon size · MX-mouse back/forward · right-click background menu |
| **Web** | Real Chromium webview · back / forward / reload · address bar · "Now Playing" lights up when YouTube/Spotify/etc. plays |
| **Terminal** | xterm.js + node-pty · click any file path to open in the editor (with line-jump) · ⌘-click URLs · ⌘F search scrollback · ⌘K clear · **⌘I "ask AI for a command"** typed into the prompt for review |
| **Process viewer** | htop-style · live CPU bars, memory bar · fuzzy filter · process kill |
| **Git** | Source-tree-equivalent: status with hunk- and line-level stage / unstage / discard · branches list with checkout / merge / rebase · stashes (save / apply / pop / drop / clear-all) · tags · commit history with cherry-pick · fetch / pull / push · "drop other branches" bulk delete |
| **Find-in-files** | ripgrep streaming · grouped by file · case / word / regex toggles · glob filter · click any match to jump to that line in the editor |
| **HTTP client** | Postman-lite: method · URL · headers (with per-row enable) · body · response with status pill, time, size, JSON pretty-print, headers viewer |
| **Excalidraw** | Embedded whiteboard · canvas bg follows the active theme · `.excalidraw` files round-trip · cross-pane sync |
| **AI Chat** | Streaming · markdown-rendered replies (with copy-code buttons on every block) · workspace context injection (attach files via dialog, open-tab picker, or drag-drop) · per-chat system prompt · token estimate · OpenAI-compat (so OpenAI / OpenRouter / Anthropic / Ollama / LM Studio all work) · API keys encrypted via Electron `safeStorage` (macOS Keychain) · history sidebar · auto-naming chat tabs from the first message · export to markdown |
| **Welcome / WelcomeScreen** | ASCII logo + cheatsheet on empty leaves |

### Workspace

- **Recursive split panes** — split horizontally (`⌘\`), vertically (`⌘=`), nest as deep as you want; each pane has its own tab strip
- **Sessions** — tmux-style, each session has its own pane tree + workspace root; `⌘⌥N` to open, `⌘⇧9` / `⌘⇧0` to switch
- **Persistence** — sessions, panes, open tabs, scratch buffers, AI chats, Git/HTTP request configs all survive restart (snapshot to `~/.marko/state.json`); per-chat archive at `~/.marko/chats/`
- **Sidebar file tree** — keyboard navigation, lazy loading, F2 rename, ⌘⌫ trash, drag-drop create
- **Workspace bookmarks** — pin folders you switch between often
- **`⌘P` quick-open** — fzf-powered file palette with **Recents** section pinned at top
- **`⌘T` go-to** — autocompleting path input, multi-suggestion list (arrow-key navigable), URL detection, command keywords (`terminal`, `git`, `chat`, `find`, `http`, `draw`, `notes`, `activity`, `history`, `whiteboard`, …)
- **Drag tabs to reorder** — both file tabs (within a pane) and session tabs
- **Now-Playing pill** in the titlebar shows whichever tab is producing audio/video; click to jump to it
- **Outline pane** adapts to tab kind: heading list for markdown, minimap for code, file preview for folder
- **15 color themes** (5 light + 10 dark): GitHub, Tokyo Night, Catppuccin, Dracula, Gruvbox, One Dark, Nord, Solarized, Rosé Pine and more — token colours and the terminal palette are derived from each theme's ANSI palette

### macOS niceties

- Hidden-inset titlebar with traffic lights, draggable region, theme-aware native shadow
- Native menus with full keyboard accelerators
- Quick Look on Space, Reveal in Finder, Open in Default App
- Custom file scheme (`marko-file://`) for streaming media into the renderer with no IPC base64 overhead
- Encrypted API key storage via Electron `safeStorage` → macOS Keychain
- MX-mouse-style X1/X2 (back/forward) buttons hooked up to folder-view history

## Keyboard shortcuts

A full cheatsheet is shown on the welcome screen and via `⌘⇧/`. Highlights:

| Action | Shortcut |
|---|---|
| **Global launcher** (works anywhere on macOS) | `⌘⌥Space` |
| Quick open file | `⌘P` |
| Go to path / command | `⌘T` |
| Clipboard history | `⌘⇧V` |
| Find in files | `⌘⇧F` |
| New file (with type picker) | `⌘N` |
| Save / Save As | `⌘S` / `⌘⇧S` |
| Close tab / pane / session | `⌘W` / `⌘⌥W` / `⌘⇧W` |
| Jump to tab N · last tab | `⌘1` – `⌘8` · `⌘9` |
| Previous / next tab | `⌘⇧[` / `⌘⇧]` |
| Previous / next session | `⌘⇧9` / `⌘⇧0` |
| New session | `⌘⌥N` |
| Split right / down | `⌘\` / `⌘=` |
| Cycle pane layout | `⌘⇧Space` |
| Next / previous pane | `⌘\`` / `⌘⇧\`` |
| Toggle sidebar / outline | `⌘E` / `⌘⇧\` |
| Toggle markdown view mode | `⌘⇧M` |
| Process viewer | `⌘Y` |
| Show all shortcuts | `⌘⇧/` |
| Settings | `⌘,` |
| Quick Look (folder) | `Space` |
| Move to Trash | `⌘⌫` |
| Terminal: find / clear / AI command | `⌘F` / `⌘K` / `⌘I` |

## Stack

- **Electron 41** — application shell
- **React 19 + TypeScript** — UI
- **Vite 8** with `vite-plugin-electron` — bundler + HMR
- **Milkdown Crepe 7** — markdown WYSIWYG (ProseMirror under the hood)
- **CodeMirror 6** + `@codemirror/language-data` — code editor
- **xterm.js + node-pty** — embedded terminal with `@xterm/addon-search` and `@xterm/addon-web-links`
- **simple-git** — Git plumbing
- **ripgrep** (system binary) — find-in-files
- **Excalidraw** — whiteboard
- **marked + DOMPurify** — assistant message rendering in chat
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

Renderer changes hot-reload instantly. Main-process and preload changes (`electron/main.ts`, `electron/preload.ts`) need `⌘Q` + `npm run dev` to pick up — they don't auto-restart Electron.

## Build a release

```bash
npm run package:mac        # both arm64 and x64 .dmg
npm run package:mac:arm    # Apple Silicon only
npm run package:mac:intel  # Intel only
```

Output lands in `release/`. The DMG is unsigned, so first-launch users right-click → Open to bypass Gatekeeper.

## Architecture

```
electron/
  main.ts          # window, menus, IPC handlers — file IO, dir walk, PTY,
                   # image load, system stats, Git (simple-git), search (rg),
                   # HTTP client, AI chat streaming, safeStorage for keys,
                   # chat archive, marko-file:// protocol
  preload.ts       # contextBridge — exposes typed window.marko API

src/
  App.tsx          # layout shell, menu/uiBus wiring, modal mux, error boundary
  state/
    workspace.ts   # sessions, binary pane tree, tabs, focus tokens,
                   # reveal state, snapshot serialize/hydrate
    settings.ts    # persisted preferences + theme application + recent files
  components/
    Sidebar.tsx          # file tree with keyboard nav, context menus
    Pane.tsx             # focused-state pane wrapper
    PaneNode.tsx         # recursive split renderer
    SessionStrip.tsx     # tmux-style top tab strip
    TabBar.tsx           # per-pane tab bar with kind icons + drag reorder
    EditorPane.tsx       # dispatches by tab kind
    NowPlaying.tsx       # titlebar pill for currently-playing tabs
    CrepeEditor.tsx      # Milkdown markdown editor
    CodeEditor.tsx       # CodeMirror with vim, theme-driven syntax,
                         # cross-pane edit sync, goto-line listener
    MarkdownSplitView.tsx
    MarkdownPreview.tsx
    FolderView.tsx       # Finder-style grid with drag-drop, bg menu, MX nav
    FolderPreview.tsx    # Outline-pane preview for folder tabs
    Outline.tsx          # heading list / minimap / folder preview
    CodeMinimap.tsx
    ImageViewer.tsx
    MediaViewer.tsx      # streams via marko-file:// protocol
    PdfViewer.tsx        # Chromium PDF embed
    CsvViewer.tsx        # rendered / raw / split
    JsonViewer.tsx       # tree / raw / split
    DiffViewer.tsx       # jsdiff unified line diff
    ExcalidrawViewer.tsx # whiteboard, theme-aware bg
    WebView.tsx          # embedded webview with media-play hooks
    Terminal.tsx         # xterm.js + node-pty, link-provider for paths,
                         # ⌘F search, ⌘K clear, ⌘I AI command generator
    ProcessViewer.tsx    # ⌘Y htop-style tab
    GitView.tsx          # status / hunk-stage / line-stage / branches /
                         # stashes / tags / log / cherry-pick / fetch/pull/push
    SearchView.tsx       # ripgrep-backed find-in-files
    HttpClient.tsx       # Postman-lite request builder + response viewer
    ChatView.tsx         # streaming AI chat with attachments, history sidebar,
                         # markdown rendering, system prompt, token tracker
    FilePalette.tsx      # ⌘P fzf with Recents section
    PathInput.tsx        # ⌘T multi-suggestion path/URL/command input
    NewFilePicker.tsx    # ⌘N file-type picker
    SettingsModal.tsx    # ⌘, preferences (themes, fonts, AI providers)
    ShortcutsModal.tsx   # ⌘⇧/ cheatsheet
    WelcomeScreen.tsx    # ASCII logo + shortcut cheatsheet
    ErrorBoundary.tsx    # top-level fallback for unhandled render errors
  lib/
    themes.ts            # 15 built-in color themes + ANSI palettes
    editorTheme.ts
    fileType.ts          # extension → kind detection + language matching
    actions.ts           # open / save / close orchestration
    persistence.ts       # snapshot → ~/.marko/state.json
    fileClipboard.ts
    diffHunks.ts         # parse + reassemble unified diffs (Git tab)
    dragReorder.ts       # shared HTML5 drag-reorder hook (tabs & sessions)
    blockDragPreview.ts
    vimSetup.ts
    slashMenuFix.ts
    uiBus.ts             # cross-component event bus
    shortcuts.ts         # cheatsheet data
  styles/global.css      # CSS variables, theme tokens, all layout
```

The pane tree is a binary tree of `LeafNode` (carries `tabIds[]` + `activeTabId`) and `SplitNode` (`direction` + `ratio` + two children). Sessions wrap that tree. All UI is rendered by recursing through the tree. Tabs live once in a flat `tabs` array; leaves hold IDs into it, so the same file open in multiple panes shares one buffer (and edits sync live across panes via a CodeMirror remote-annotation pattern).

## License

MIT — do whatever you want with it.
