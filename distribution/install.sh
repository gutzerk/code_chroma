#!/bin/sh
# One-command installer for CodeChroma on macOS (arm64/x64) and Linux (x64), in the style of
# herdr's distribution/: it reads distribution/latest.json (the single install manifest) and installs the
# platform's pre-built GUI installer from the matching GitHub Release. No local checkout, no build.
#
#   curl -fsSL https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.sh | sh
#
set -eu

MANIFEST_URL="${CODECROMA_MANIFEST_URL:-https://github.com/gutzerk/code_chroma/releases/latest/download/latest.json}"
DOWNLOAD_DIR="${HOME}/Downloads"
MAX_BYTES=1073741824   # 1 GiB; fail-fast cap so a rogue oversized asset can't fill the disk

log()  { printf '  \033[32m>\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }
# Keep only safe file-name characters; a hostile asset name must never reach a shell path unchecked.
safe_name() { printf '%s' "${1##*/}" | tr -cd 'A-Za-z0-9._-'; }
need() { command -v "$1" >/dev/null 2>&1 || err "requires '$1' -- install it first."; }

INSTALL_SCOPE="user"
case "${1:-}" in
    "") ;;
    --system) INSTALL_SCOPE="system" ;;
    *) err "usage: install.sh [--system]" ;;
esac

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
    linux-x86_64)
        if [ "$INSTALL_SCOPE" = "system" ]; then target="linux-x64"; else target="linux-appimage"; fi
        ;;
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
        MOUNT="$(mktemp -d /tmp/codechroma-install.XXXXXX)"
        attach_cleanup() { hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true; rmdir "$MOUNT" 2>/dev/null || true; }
        trap 'attach_cleanup; rm -rf "$TMP"' EXIT
        hdiutil attach "$DEST" -nobrowse -mountpoint "$MOUNT" >/dev/null
        [ -d "$MOUNT/CodeChroma.app" ] || err "CodeChroma.app not found in the downloaded DMG."
        if [ "$INSTALL_SCOPE" = "system" ]; then
            log "System-wide install will replace /Applications/CodeChroma.app. This writes to the shared Applications folder, so macOS will request administrator authorization."
            need sudo
            sudo -v
            sudo rm -rf /Applications/CodeChroma.app
            sudo cp -R "$MOUNT/CodeChroma.app" /Applications/
            log "done. launch with:  open /Applications/CodeChroma.app"
        else
            APP_DIR="${HOME}/Applications"
            mkdir -p "$APP_DIR"
            rm -rf "${APP_DIR}/CodeChroma.app"
            cp -R "$MOUNT/CodeChroma.app" "$APP_DIR/"
            log "done. launch with:  open ${APP_DIR}/CodeChroma.app"
        fi
        ;;
    linux)
        if [ "$INSTALL_SCOPE" = "system" ]; then
            command -v apt-get >/dev/null 2>&1 || err "system installation requires apt-get."
            log "System-wide install will install ${ASSET} through apt into system package locations (including /usr) and may install dependencies. Administrator authorization is required."
            need sudo
            sudo -v
            sudo apt-get install -y "$DEST"
            log "done. launch with:  codechroma-desktop"
        else
            APP_DIR="${HOME}/Applications"
            APP_PATH="${APP_DIR}/CodeChroma.AppImage"
            mkdir -p "$APP_DIR"
            cp "$DEST" "$APP_PATH"
            chmod 755 "$APP_PATH"
            log "done. launch with:  ${APP_PATH}"
        fi
        ;;
esac

if [ "$os" = "linux" ] && [ "$INSTALL_SCOPE" = "user" ]; then
    warn "The AppImage is installed for this user only; no system directories or package database were changed."
fi
