# Marko

A Typora-like markdown editor for macOS, built with Electron + React + Milkdown.

## Features

- WYSIWYG markdown editing (live, in-place rendering — no separate preview pane)
- File tree sidebar — open a folder and browse markdown files
- Multi-tab editing
- Outline sidebar with heading hierarchy
- macOS-native window chrome (hidden inset titlebar, traffic lights)
- Light & dark theme that follows the system
- Standard shortcuts: ⌘N new, ⌘O open, ⌘⇧O open folder, ⌘S save, ⌘⇧S save as, ⌘W close tab, ⌘\ toggle sidebar, ⌘⇧\ toggle outline

## Development

```bash
npm install
npm run dev      # launches Electron with Vite HMR
```

## Packaging

```bash
npm run package:mac  # produces a .dmg in release/
```

## Stack

- **Electron** — application shell
- **Vite** — bundler (with `vite-plugin-electron`)
- **React + TypeScript** — UI layer
- **Milkdown Crepe** — WYSIWYG markdown editor (ProseMirror-based)

## Architecture

```
electron/
  main.ts         # main process: window, menus, file IO via IPC
  preload.ts      # contextBridge exposing safe IPC to renderer

src/
  App.tsx                # layout shell + menu wiring
  state/workspace.ts     # tabs/dirty/sidebar store
  components/
    Sidebar.tsx          # file tree
    TabBar.tsx           # tabs
    EditorPane.tsx       # hosts one Crepe editor per tab
    CrepeEditor.tsx      # Milkdown Crepe wrapper
    Outline.tsx          # heading list
  lib/actions.ts         # open / save / close orchestration
  styles/global.css      # theme tokens, layout, Crepe overrides
```
