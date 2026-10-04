#!/usr/bin/env bash
# One-command installer for CodeChroma on Linux (x64): downloads a pre-built release artifact and
# installs the AppImage into ~/Applications by default.
# No local checkout, no dev toolchain, no build -- the release CI already assembled the .deb.
#
#   curl -fsSL https://raw.githubusercontent.com/UshakovDV/code-chroma/main/scripts/install_linux.sh | bash
#
# Linux x64 only. The optional --system .deb path is for Debian/Ubuntu.
set -euo pipefail

INSTALL_SCOPE="user"
case "${1:-}" in
  "") ;;
  --system) INSTALL_SCOPE="system" ;;
  *) echo "Usage: install_linux.sh [--system]" >&2; exit 1 ;;
esac

REPO="UshakovDV/code-chroma"
DOWNLOAD_DIR="${HOME}/Downloads"
MAX_BYTES=1073741824   # 1 GiB; fail-fast cap so a rogue oversized asset can't fill the disk

say() { printf '\n==> %s\n' "$*"; }
fatal() { printf '\n🔴 %s\n' "$*" >&2; exit 1; }
# Keep only safe file-name characters; a hostile asset name must never reach a shell path unchecked.
safe_name() { printf '%s' "${1##*/}" | tr -cd 'A-Za-z0-9._-'; }

# --- platform guard ---------------------------------------------------------
[[ "$(uname -s)" = "Linux" ]] || fatal "This installer installs the Linux app; run it on Linux."
[[ "$(uname -m)" = "x86_64" ]] || fatal "This build only supports x86_64 (x64)."

# --- resolve the latest release asset ----------------------------------------
# Query the GitHub API for the newest release, then pick an AppImage by default or a .deb for
# the explicitly requested system-wide installation.
say "Resolving the latest CodeChroma release"
RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")" \
  || fatal "Couldn't reach the GitHub API. Check network or that a release exists yet."
ASSET_NAME="$(
  printf '%s' "$RELEASE_JSON" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); suffix="-x64.deb" if sys.argv[1] == "system" else "-x64.AppImage"; a=[x for x in d["assets"] if x["name"].endswith(suffix)]; print(a[0]["name"] if a else "")' "$INSTALL_SCOPE"
)"
[[ -n "$ASSET_NAME" ]] || fatal "Latest release has no Linux (x64) asset for a ${INSTALL_SCOPE} installation."
ASSET="$(safe_name "$ASSET_NAME")"
URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"

# --- download ---------------------------------------------------------------
mkdir -p "$DOWNLOAD_DIR"
DEST="${DOWNLOAD_DIR}/${ASSET}"
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
  say "Downloading ${ASSET}"
  download_ok || fatal "Download failed, or the asset exceeds 1 GiB."
else
  say "Already downloaded: ${DEST}"
fi

# --- integrity check --------------------------------------------------------
# Verify the release asset against its SHA-256 sidecar before it's installed. A mismatch can
# mean a stale cached copy or a tampered download; either way we redownload once, then fail hard.
say "Verifying SHA-256 checksum"
ACTUAL="$(sha256sum "$DEST" | awk '{print $1}')"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  say "Checksum mismatch; redownloading"
  rm -f "$DEST"
  download_ok || fatal "Download failed, or the asset exceeds 1 GiB."
  ACTUAL="$(sha256sum "$DEST" | awk '{print $1}')"
fi
[[ "$ACTUAL" = "$EXPECTED" ]] || fatal "Checksum mismatch — the download is corrupted or tampered with."
rm -f "$SHA256_FILE"

# --- install into the selected location -------------------------------------
if [[ "$INSTALL_SCOPE" == "system" ]]; then
  say "System-wide install will install ${ASSET} through apt/dpkg into system package locations (including /usr) and may install dependencies. Administrator authorization is required."
  command -v sudo >/dev/null 2>&1 || fatal "System-wide installation requires sudo."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get install -y "$DEST"
  else
    sudo dpkg --install "$DEST"
  fi
  say "Done. Launch with:  codechroma-desktop"
else
  APP_DIR="${HOME}/Applications"
  APP_PATH="${APP_DIR}/CodeChroma.AppImage"
  mkdir -p "$APP_DIR"
  cp "$DEST" "$APP_PATH"
  chmod 755 "$APP_PATH"
  say "Done. Launch with:  ${APP_PATH}"
fi
