#!/usr/bin/env bash
# Builds CodeChroma.app for the host architecture: SPA bundle -> frozen bridge -> unsigned DMG.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> generating the app icon from SVG"
npm --prefix desktop run generate-icon

echo "==> 1/3 building the canvas bundle (same-origin: the bridge will serve it)"
VITE_ENGINE_BRIDGE_URL=same-origin \
VITE_TERMINAL_BRIDGE_URL=same-origin \
  npm --prefix web run build

echo "==> 2/3 freezing the bridge with PyInstaller"
poetry run pyinstaller packaging/bridge.spec --noconfirm --clean

echo "==> 3/3 packaging the Electron app"
npm --prefix desktop run dist

echo
echo "Done. Installer:"
ls -1 "$ROOT"/desktop/dist/*.dmg
