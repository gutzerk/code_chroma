#!/usr/bin/env bash
# One-command installer for CodeChroma on Debian/Ubuntu Linux (x64): downloads the pre-built
# CodeChroma-<version>-x64.deb from the latest GitHub Release and installs it with dpkg.
# No local checkout, no dev toolchain, no build -- the release CI already assembled the .deb.
#
#   curl -fsSL https://raw.githubusercontent.com/UshakovDV/code-chroma/main/scripts/install_linux.sh | bash
#
# Debian/Ubuntu x64 only (that's the only Linux artifact the release workflow builds).
set -euo pipefail

REPO="UshakovDV/code-chroma"
DEB_DIR="${HOME}/Downloads"
MAX_BYTES=1073741824   # 1 GiB; fail-fast cap so a rogue oversized asset can't fill the disk

say() { printf '\n==> %s\n' "$*"; }
fatal() { printf '\n🔴 %s\n' "$*" >&2; exit 1; }
# Keep only safe file-name characters; a hostile asset name must never reach a shell path unchecked.
safe_name() { printf '%s' "${1##*/}" | tr -cd 'A-Za-z0-9._-'; }

# --- platform guard ---------------------------------------------------------
[[ "$(uname -s)" = "Linux" ]] || fatal "This installer installs the Linux app; run it on Linux."
[[ "$(uname -m)" = "x86_64" ]] || fatal "This build only supports x86_64 (x64)."

# --- resolve the latest release asset ----------------------------------------
# Query the GitHub API for the newest release, then pick the x64 .deb asset.
say "Resolving the latest CodeChroma release"
RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")" \
  || fatal "Couldn't reach the GitHub API. Check network or that a release exists yet."
DEB="$(
  printf '%s' "$RELEASE_JSON" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); a=[x for x in d["assets"] if x["name"].endswith("-x64.deb")]; print(a[0]["name"] if a else "")'
)"
[[ -n "$DEB" ]] || fatal "Latest release has no Linux (x64) .deb asset yet."
DEB="$(safe_name "$DEB")"
URL="https://github.com/${REPO}/releases/latest/download/${DEB}"

# --- download ---------------------------------------------------------------
mkdir -p "$DEB_DIR"
DEST="${DEB_DIR}/${DEB}"
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
  say "Downloading ${DEB}"
  download_ok || fatal "Download failed, or the asset exceeds 1 GiB."
else
  say "Already downloaded: ${DEST}"
fi

# --- integrity check --------------------------------------------------------
# Verify the .deb against the release's SHA-256 sidecar before it's installed as root. A mismatch can
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

# --- install via dpkg --------------------------------------------------------
# dpkg --install takes admin rights, so run it through sudo. On a clean box the package may have
# unmet dependencies (e.g. libgtk). Prefer `apt install` on the downloaded .deb: it resolves those
# automatically and is idempotent. Fall back to a plain dpkg --install if apt isn't available.
say "Installing ${DEB} (admin password may be requested)"
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get install -y "$DEST"
else
  sudo dpkg --install "$DEST"
fi

say "Done. Launch with:  codechroma-desktop"
