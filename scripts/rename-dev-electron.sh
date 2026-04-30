#!/usr/bin/env bash
# Renames the bundled dev Electron app to "Marko" so the macOS menu bar
# shows "Marko" instead of "Electron" during `npm run dev`.
# Production builds (via `npm run package:mac`) already use the correct
# productName from package.json — this script only matters for dev.
#
# Run once after `npm install`. If you reinstall Electron, run it again.
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "rename-dev-electron: skipping (not macOS)"
  exit 0
fi

PLIST="node_modules/electron/dist/Electron.app/Contents/Info.plist"
if [[ ! -f "$PLIST" ]]; then
  echo "rename-dev-electron: Electron.app not found at $PLIST"
  exit 0
fi

plutil -replace CFBundleName -string "Marko" "$PLIST"
plutil -replace CFBundleDisplayName -string "Marko" "$PLIST"

echo "rename-dev-electron: patched $PLIST"
