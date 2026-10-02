#!/usr/bin/env bash
# Builds CodeChroma.app: SPA bundle -> frozen Python bridge -> Electron DMG (macOS arm64, unsigned).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f desktop/build/icon.png ]]; then
  echo "==> generating the app icon"
  poetry run python scripts/make_desktop_icon.py
fi

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
