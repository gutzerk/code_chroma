y#!/usr/bin/env bash
# Developer build for the CodeChroma desktop app (macOS arm64). SPA bundle -> frozen Python bridge
# -> Electron DMG. Kept under scripts/dev/ (install_desktop.sh, the clean-machine installer, lives
# at scripts/ because it is fetched by a fixed curl URL).
#
#   ./scripts/dev/build_desktop.sh              # build only, produce the installer artifact
#   ./scripts/dev/build_desktop.sh --install    # build, then replace /Applications/CodeChroma.app
#                                               # (quit running app + refresh indexes)
set -euo pipefail

# Script lives at scripts/dev/, so climb two levels to reach the repo root.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=1 ;;
    *) echo "🔴 Unknown argument: $arg (expected --install)" >&2; exit 1 ;;
  esac
done

# --- platform detection ------------------------------------------------------
# macOS-only: the install/quit/index-refresh steps below use Apple tools (hdiutil, osascript,
# Dock, Spotlight). On Windows run the same three npm/poetry/pyinstaller stages manually or via a
# Windows-native script, and install with the .exe installer.
OS_NAME="$(uname -s)"
case "$OS_NAME" in
  Darwin) ;;
  *)
    echo "🔴 Unsupported OS: $OS_NAME (this script is macOS-only)" >&2
    exit 1
    ;;
esac

if [[ ! -f desktop/build/icon.png ]]; then
  echo "==> generating the app icon (electron-builder derives .icns/.ico from it)"
  poetry run python scripts/make_desktop_icon.py
fi

echo "==> 1/3 building the canvas bundle (same-origin: the bridge will serve it) [macOS arm64]"
VITE_ENGINE_BRIDGE_URL=same-origin \
VITE_TERMINAL_BRIDGE_URL=same-origin \
  npm --prefix web run build

echo "==> 2/3 freezing the bridge with PyInstaller (bridge.spec picks arm64/x64 by sys.platform) [macOS arm64]"
poetry install
poetry run pyinstaller packaging/bridge.spec --noconfirm --clean

echo "==> 3/3 packaging the Electron app (electron-builder picks dmg/nsis from electron-builder.yml) [macOS arm64]"
npm --prefix desktop run dist

DMGS=( "$ROOT"/desktop/dist/*.dmg )
[[ ${#DMGS[@]} -gt 0 && -f "${DMGS[0]}" ]] || { echo "🔴 No DMG found in desktop/dist — build failed?" >&2; exit 1; }
DMG="${DMGS[0]}"

if [[ "$INSTALL" != "1" ]]; then
  echo
  echo "Done. Installer: $DMG"
  exit 0
fi

# --- --install: replace /Applications/CodeChroma.app (macOS-only) -----------------
# Local dev reinstall: run as the invoking user, quit a running app, refresh indexes.
APP_NAME="CodeChroma.app"
INSTALL_DIR="/Applications"

if pgrep -x "CodeChroma" >/dev/null 2>&1; then
  echo "==> quitting the running app"
  osascript -e 'quit app "CodeChroma"' >/dev/null 2>&1 || true
  sleep 1
  pkill -x "CodeChroma" 2>/dev/null || true
fi

echo "==> installing from $DMG"
MOUNT_DIR="$(mktemp -d /tmp/codechroma-mount.XXXXXX)"
hdiutil attach "$DMG" -nobrowse -mountpoint "$MOUNT_DIR" >/dev/null

cleanup() {
  hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  rmdir "$MOUNT_DIR" 2>/dev/null || true
}
trap cleanup EXIT

[[ -d "$MOUNT_DIR/$APP_NAME" ]] || { echo "🔴 $APP_NAME not found in the DMG" >&2; exit 1; }

# Make the write idempotent: remove a prior install if present, then copy the fresh one.
# ${VAR:?} guards the destructive rm in case INSTALL_DIR/APP_NAME are ever emptied.
if [[ -d "$INSTALL_DIR/$APP_NAME" ]]; then
  echo "==> removing existing $INSTALL_DIR/$APP_NAME"
  rm -rf "${INSTALL_DIR:?}/${APP_NAME:?}"
fi

echo "==> copying to $INSTALL_DIR"
cp -R "$MOUNT_DIR/$APP_NAME" "$INSTALL_DIR/"

# Locally built, so there's normally no quarantine flag -- stripped defensively in case the
# dmg ever passed through something (Mail, a browser download) that would set one.
xattr -dr com.apple.quarantine "${INSTALL_DIR:?}/${APP_NAME:?}" 2>/dev/null || true

# Refresh the system indexes so Launchpad/Spotlight don't show a stale duplicate entry
# after the app was removed and re-copied above. Runs as the invoking user, so this only
# ever touches that user's own Dock/Spotlight caches.
echo "==> refreshing Launchpad index"
find "$HOME/Library/Application Support/Dock" -name "*.db" -delete 2>/dev/null || true
killall Dock 2>/dev/null || true

echo "==> nudging Spotlight to re-index the app"
mdimport "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true

echo
echo "Done. Installed: $INSTALL_DIR/$APP_NAME"
