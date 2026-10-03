#!/bin/sh
# One-command installer for CodeChroma on macOS (arm64/x64) and Linux (x64), in the style of
# herdr's distribution/: it reads distribution/latest.json (the single install manifest) and installs the
# platform's pre-built GUI installer from the matching GitHub Release. No local checkout, no build.
#
#   curl -fsSL https://raw.githubusercontent.com/gutzerk/code-chroma/main/distribution/install.sh | sh
#
set -eu

APP="codechroma"
MANIFEST_URL="${CODECROMA_MANIFEST_URL:-https://github.com/gutzerk/code-chroma/releases/latest/download/latest.json}"
DOWNLOAD_DIR="${HOME}/Downloads"
MAX_BYTES=1073741824   # 1 GiB; fail-fast cap so a rogue oversized asset can't fill the disk

log()  { printf '  \033[32m>\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }
# Keep only safe file-name characters; a hostile asset name must never reach a shell path unchecked.
safe_name() { printf '%s' "${1##*/}" | tr -cd 'A-Za-z0-9._-'; }
need() { command -v "$1" >/dev/null 2>&1 || err "requires '$1' -- install it first."; }

# --- resolve OS/arch to a manifest target key --------------------------------
OS="$(uname -s)"
case "$OS" in
    Linux)  os="linux" ;;
    Darwin) os="macos" ;;
    *) err "unsupported OS: $OS" ;;
esac
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64|amd64)          arch="x86_64" ;;
    aarch64|arm64)         arch="arm64" ;;
    *) err "unsupported architecture: $ARCH" ;;
esac

# Linux builds are x64-only (the only Linux artifacts the release CI builds).
case "$os-$arch" in
    macos-arm64)   target="macos-arm64" ;;
    macos-x86_64)  target="macos-x64" ;;
    linux-x86_64)  target="linux-x64" ;;
    *) err "no CodeChroma build for ${os}/${arch}; only macOS arm64/x64 and Linux x64 are released." ;;
esac

need curl
need awk
need python3   # manifest JSON parsing (present on macOS and all modern Linux)

log "detected ${os}/${arch} (target ${target})"

# --- fetch the manifest and pull out this target's URL + checksum --------------
log "fetching latest release manifest..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
MANIFEST_FILE="${TMP}/latest.json"
curl -fsSL --retry 3 --connect-timeout 10 --max-time 30 "$MANIFEST_URL" -o "$MANIFEST_FILE" \
    || err "can't reach ${MANIFEST_URL}. Check network, or that a release exists yet."

URL="$(   python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.stdout.write(d["assets"].get(sys.argv[2],"") or "")' "$MANIFEST_FILE" "$target")"
SHA256="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.stdout.write(d["sha256"].get(sys.argv[2],"") or "")' "$MANIFEST_FILE" "$target")"
VERSION="$( python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.stdout.write(d.get("version",""))' "$MANIFEST_FILE")"

[ -n "$URL" ] || err "release manifest has no binary for ${target}."
[ "${#SHA256}" -eq 64 ] || err "release manifest has no valid SHA-256 for ${target}."

ASSET="$(safe_name "${URL##*/}")"
[ -n "$ASSET" ] || err "could not derive a file name from the manifest URL."

# --- download ----------------------------------------------------------------
mkdir -p "$DOWNLOAD_DIR"
DEST="${DOWNLOAD_DIR}/${ASSET}"
if [ -f "$DEST" ]; then
    log "already downloaded: ${DEST}"
else
    log "downloading ${ASSET}"
    curl -fsSL --retry 3 --connect-timeout 10 --speed-limit 1024 --speed-time 30 --max-filesize "$MAX_BYTES" "$URL" -o "$DEST" \
        || err "download failed from ${URL}"
    # Fail-fast size cap: a rogue/oversized asset must not fill the disk. --max-filesize honors
    # Content-Length; wc -c guards the chunked/no-CL case curl cannot pre-limit.
    if [ "$(wc -c < "$DEST")" -gt "$MAX_BYTES" ]; then
        rm -f "$DEST"
        err "download exceeds ${MAX_BYTES} bytes; refusing oversized asset"
    fi
fi

# --- integrity check ----------------------------------------------------------
log "verifying SHA-256 checksum"
if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "$DEST" | awk '{print $1}')"
else
    ACTUAL="$(shasum -a 256 "$DEST" | awk '{print $1}')"
fi
if [ "$ACTUAL" != "$SHA256" ]; then
    log "checksum mismatch; redownloading"
    rm -f "$DEST"
    curl -fsSL --retry 3 --connect-timeout 10 --speed-limit 1024 --speed-time 30 --max-filesize "$MAX_BYTES" "$URL" -o "$DEST" \
        || err "download failed from ${URL}"
    [ "$(wc -c < "$DEST")" -le "$MAX_BYTES" ] || { rm -f "$DEST"; err "download exceeds ${MAX_BYTES} bytes; refusing oversized asset"; }
    ACTUAL="$( (command -v sha256sum >/dev/null 2>&1 && sha256sum "$DEST" || shasum -a 256 "$DEST") | awk '{print $1}')"
fi
[ "$ACTUAL" = "$SHA256" ] || err "checksum mismatch -- the download is corrupted or tampered with."

# --- install by platform -------------------------------------------------------
case "$os" in
    macos)
        need hdiutil
        log "installing CodeChroma.app into /Applications (admin password may be requested)"
        sudo -v
        MOUNT="$(mktemp -d /tmp/codechroma-install.XXXXXX)"
        attach_cleanup() { hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true; rmdir "$MOUNT" 2>/dev/null || true; }
        trap 'attach_cleanup; rm -rf "$TMP"' EXIT
        hdiutil attach "$DEST" -nobrowse -mountpoint "$MOUNT" >/dev/null
        [ -d "$MOUNT/CodeChroma.app" ] || err "CodeChroma.app not found in the downloaded DMG."
        sudo rm -rf /Applications/CodeChroma.app
        sudo cp -R "$MOUNT/CodeChroma.app" /Applications/
        log "done. launch with:  open /Applications/CodeChroma.app"
        ;;
    linux)
        [ "$(id -u)" -eq 0 ] && SUDO="" || SUDO="sudo"
        command -v apt-get >/dev/null 2>&1 || err "this Linux build packages a .deb; apt-get is required."
        log "installing ${ASSET} (admin password may be requested)"
        $SUDO apt-get install -y "$DEST"
        log "done. launch with:  codechroma-desktop"
        ;;
esac

warn "if the app is on PATH but not found yet, start a new shell or add ${DOWNLOAD_DIR} -- ${APP} was installed there."
