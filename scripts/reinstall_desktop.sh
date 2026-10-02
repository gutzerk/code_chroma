#!/usr/bin/env bash
# Rebuilds CodeChroma.app from source (via build_desktop.sh) and installs it into /Applications,
# quitting and replacing any existing copy there.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="CodeChroma.app"
INSTALL_DIR="/Applications"

echo "==> building CodeChroma.app"
"$ROOT/scripts/build_desktop.sh"

DMG="$(ls -t "$ROOT"/desktop/dist/*.dmg | head -1)"
echo "==> installing from $DMG"

if pgrep -x "CodeChroma" >/dev/null 2>&1; then
  echo "==> quitting the running app"
  osascript -e 'quit app "CodeChroma"' >/dev/null 2>&1 || true
  sleep 1
  pkill -x "CodeChroma" 2>/dev/null || true
fi

MOUNT_DIR="$(mktemp -d /tmp/codechroma-mount.XXXXXX)"
hdiutil attach "$DMG" -nobrowse -mountpoint "$MOUNT_DIR" >/dev/null

cleanup() {
  hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  rmdir "$MOUNT_DIR" 2>/dev/null || true
}
trap cleanup EXIT

if [[ ! -d "$MOUNT_DIR/$APP_NAME" ]]; then
  echo "error: $APP_NAME not found on the mounted volume" >&2
  exit 1
fi

if [[ -d "$INSTALL_DIR/$APP_NAME" ]]; then
  echo "==> removing existing $INSTALL_DIR/$APP_NAME"
  rm -rf "$INSTALL_DIR/$APP_NAME"
fi

echo "==> copying to $INSTALL_DIR"
cp -R "$MOUNT_DIR/$APP_NAME" "$INSTALL_DIR/"

# Locally built, so there's normally no quarantine flag -- stripped defensively in case the dmg
# ever passed through something (Mail, a browser download) that would set one.
xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true

echo
echo "Done. Installed: $INSTALL_DIR/$APP_NAME"
