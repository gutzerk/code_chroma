#!/usr/bin/env bash
# One-command installer for CodeChroma on macOS: downloads the pre-built DMG for this Mac's
# architecture from the latest GitHub Release and installs it into ~/Applications by default.
# No local checkout, no dev toolchain, no build — the release CI already assembled the DMG.
#
#   curl -fsSL https://raw.githubusercontent.com/UshakovDV/code-chroma/main/scripts/install_desktop.sh | bash
#
set -euo pipefail

INSTALL_SCOPE="user"
case "${1:-}" in
  "") ;;
  --system) INSTALL_SCOPE="system" ;;
  *) echo "Usage: install_desktop.sh [--system]" >&2; exit 1 ;;
esac

REPO="UshakovDV/code-chroma"
DMG_DIR="${HOME}/Downloads"
MAX_BYTES=1073741824   # 1 GiB; fail-fast cap so a rogue oversized asset can't fill the disk

say() { printf '\n==> %s\n' "$*"; }
fatal() { printf '\n🔴 %s\n' "$*" >&2; exit 1; }
# Keep only safe file-name characters; a hostile asset name must never reach a shell path unchecked.
safe_name() { printf '%s' "${1##*/}" | tr -cd 'A-Za-z0-9._-'; }

# --- platform guard ---------------------------------------------------------
[[ "$(uname -s)" = "Darwin" ]] || fatal "This installer installs the macOS app; run it on a Mac."
case "$(uname -m)" in
  arm64)  ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) fatal "This build supports Apple Silicon (arm64) and Intel (x64) Macs only." ;;
esac

# --- resolve the latest release asset ----------------------------------------
# Query the GitHub API for the newest release, then pick this architecture's DMG asset. The API avoids
# guessing the version, and the `latest` redirect endpoint doesn't reliably work with globs.
say "Resolving the latest CodeChroma release"
RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")" \
  || fatal "Couldn't reach the GitHub API. Check network or that a release exists yet."
DMG="$(
  printf '%s' "$RELEASE_JSON" \
    | python3 -c 'import json,sys; suffix="-"+sys.argv[1]+".dmg"; d=json.load(sys.stdin); a=[x for x in d["assets"] if x["name"].endswith(suffix)]; print(a[0]["name"] if a else "")' "$ARCH"
)"
[[ -n "$DMG" ]] || fatal "Latest release has no macOS (${ARCH}) DMG asset yet."
DMG="$(safe_name "$DMG")"
URL="https://github.com/${REPO}/releases/latest/download/${DMG}"

# --- download ---------------------------------------------------------------
mkdir -p "$DMG_DIR"
DEST="${DMG_DIR}/${DMG}"
SHA256_FILE="${DEST}.sha256"

# Fetch the checksum first: we never download a file we don't have a digest for yet.
say "Fetching SHA-256 checksum"
curl -fsSL "${URL}.sha256" -o "$SHA256_FILE" || fatal "No checksum published for this release; refusing to install unverified."
EXPECTED="$(awk '{print $1}' "$SHA256_FILE")"

# Download (cached copy reused when present), capped so a rogue oversized asset can't fill the disk.
download_ok() {
  local size
  size="$(curl -fsSI "$URL" | awk 'tolower($1)=="content-length:" {printf "%d", $2}')"
  [[ -n "$size" && "$size" -gt "$MAX_BYTES" ]] && return 2
  curl -fL "$URL" -o "$DEST"
}
if [[ ! -f "$DEST" ]]; then
  say "Downloading ${DMG}"
  download_ok || fatal "Download failed, or the asset exceeds 1 GiB."
else
  say "Already downloaded: ${DEST}"
fi

# --- integrity check --------------------------------------------------------
# Verify the DMG against the release's SHA-256 sidecar before mounting it. A mismatch can
# mean a stale cached copy or a tampered download; either way we redownload once, then fail hard.
say "Verifying SHA-256 checksum"
ACTUAL="$(shasum -a 256 "$DEST" | awk '{print $1}')"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  say "Checksum mismatch; redownloading"
  rm -f "$DEST"
  download_ok || fatal "Download failed, or the asset exceeds 1 GiB."
  ACTUAL="$(shasum -a 256 "$DEST" | awk '{print $1}')"
fi
[[ "$ACTUAL" = "$EXPECTED" ]] || fatal "Checksum mismatch — the download is corrupted or tampered with."
rm -f "$SHA256_FILE"

# --- install into the selected Applications folder -----------------------------
if [[ "$INSTALL_SCOPE" == "system" ]]; then
  say "System-wide install will replace /Applications/CodeChroma.app. This writes to the shared Applications folder, so macOS will request administrator authorization."
  command -v sudo >/dev/null 2>&1 || fatal "System-wide installation requires sudo."
  sudo -v
  INSTALL_DIR="/Applications"
else
  INSTALL_DIR="${HOME}/Applications"
  mkdir -p "$INSTALL_DIR"
fi
MOUNT="$(mktemp -d /tmp/codechroma-install.XXXXXX)"
attach_cleanup() { hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true; rmdir "$MOUNT" 2>/dev/null || true; }
trap attach_cleanup EXIT
hdiutil attach "$DEST" -nobrowse -mountpoint "$MOUNT" >/dev/null
[[ -d "$MOUNT/CodeChroma.app" ]] || fatal "CodeChroma.app not found in the downloaded DMG."
# Make the write idempotent: remove a prior install if present, then copy the fresh one.
# "/Applications" is a hard literal (unsafe for a variable that could empty out), so the
# destructive rm only ever targets this exact path.
if [[ "$INSTALL_SCOPE" == "system" ]]; then
  sudo rm -rf /Applications/CodeChroma.app
  sudo cp -R "$MOUNT/CodeChroma.app" /Applications/
else
  rm -rf "${INSTALL_DIR}/CodeChroma.app"
  cp -R "$MOUNT/CodeChroma.app" "$INSTALL_DIR/"
fi

say "Done. Launch with:  open ${INSTALL_DIR}/CodeChroma.app"
