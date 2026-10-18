#!/bin/sh
# One-command installer for CodeChroma on macOS (arm64/x64) and Linux (x64). It reads the release's
# latest.json manifest and installs the pre-built C# app (Velopack package) from the matching GitHub Release.
# No local checkout, no build, no python.
#
#   curl -fsSL https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --uninstall   # remove the app; add --purge to drop user data
#
# Options: --force  --uninstall  --purge  --help   (--dotnet is accepted and ignored: the C# app is the only app)
# Test hooks (weaken security, never set in production): CODECROMA_MANIFEST_URL,
# CODECROMA_MAX_BYTES, CODECROMA_GH_BIN.
set -eu

REPO="gutzerk/code_chroma"
MANIFEST_URL="${CODECROMA_MANIFEST_URL:-https://github.com/${REPO}/releases/latest/download/latest.json}"
MAX_BYTES="${CODECROMA_MAX_BYTES:-1073741824}"   # 1 GiB cap so a rogue asset can't fill the disk
GH_BIN="${CODECROMA_GH_BIN:-gh}"
SIGNER_WORKFLOW="${REPO}/.github/workflows/release-please.yml"
STATE_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/codechroma"
STATE_FILE="${STATE_DIR}/installed"
APP_DIR="${HOME}/Applications"

log()  { printf '  \033[32m>\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
err()  { printf '  \033[31mx\033[0m %s\n' "$1" >&2; exit 1; }
# Keep only safe file-name characters; a hostile asset name must never reach a shell path unchecked.
safe_name() { printf '%s' "${1##*/}" | tr -cd 'A-Za-z0-9._-'; }
need() { command -v "$1" >/dev/null 2>&1 || err "requires '$1' -- install it first."; }
usage() { printf 'usage: install.sh [--force] [--uninstall [--purge]]\n'; }

# The C# app installs per user at the paths the old Electron build used and keeps its user-data folder.
APP_FLAVOR="dotnet"
INSTALL_SCOPE="user"
FORCE=0
UNINSTALL=0
PURGE=0
for arg in "$@"; do
    case "$arg" in
        --system) usage >&2; err "there is no system-wide package of the C# app; it installs per user only." ;;
        --dotnet) ;;
        --force) FORCE=1 ;;
        --uninstall) UNINSTALL=1 ;;
        --purge) PURGE=1 ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; err "usage: unknown option '$arg'" ;;
    esac
done
[ "$PURGE" -eq 0 ] || [ "$UNINSTALL" -eq 1 ] || err "usage: --purge only works together with --uninstall"

# --- resolve OS/arch ------------------------------------------------------------
OS="$(uname -s)"
case "$OS" in
    Linux)  os="linux" ;;
    Darwin) os="macos" ;;
    *) err "unsupported OS: $OS (Windows: use install.ps1)" ;;
esac
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64|amd64)  arch="x86_64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) err "unsupported architecture: $ARCH" ;;
esac

# --- uninstall ------------------------------------------------------------------
purge_user_data() {
    if [ "$os" = "macos" ]; then
        rm -rf "${HOME}/Library/Application Support/CodeChroma" "${HOME}/Library/Logs/CodeChroma" \
            "${HOME}/Library/Caches/CodeChroma"
    else
        rm -rf "${XDG_CONFIG_HOME:-${HOME}/.config}/CodeChroma" "${XDG_CACHE_HOME:-${HOME}/.cache}/CodeChroma"
    fi
    rm -rf "${HOME}/.codechroma"
    log "removed user data (settings, recents, diagram types)"
}

uninstall() {
    found=0
    if [ "$os" = "macos" ]; then
        if [ -d "${APP_DIR}/CodeChroma.app" ]; then rm -rf "${APP_DIR}/CodeChroma.app"; found=1; fi
    else
        if [ -e "${APP_DIR}/CodeChroma.AppImage" ]; then rm -f "${APP_DIR}/CodeChroma.AppImage"; found=1; fi
        rm -f "${XDG_DATA_HOME:-${HOME}/.local/share}/applications/codechroma.desktop"
        if [ -L "${HOME}/.local/bin/codechroma" ]; then rm -f "${HOME}/.local/bin/codechroma"; fi
    fi
    rm -rf "$STATE_DIR"
    if [ "$found" -eq 1 ]; then log "CodeChroma removed."; else log "CodeChroma is not installed; nothing to remove."; fi
    if [ "$PURGE" -eq 1 ]; then purge_user_data; else log "user data kept (re-run with --uninstall --purge to delete it)"; fi
}

if [ "$UNINSTALL" -eq 1 ]; then uninstall; exit 0; fi

case "$os-$arch" in
    macos-arm64)   target="dotnet-macos-arm64" ;;
    macos-x86_64)  target="dotnet-macos-x64" ;;
    linux-x86_64)  target="dotnet-linux-x64" ;;
    *) err "no CodeChroma build for ${os}/${arch}; only macOS arm64/x64 and Linux x64 are released." ;;
esac

need curl
need awk
log "detected ${os}/${arch} (target ${target})"

# --- manifest parsing (no python): flatten JSON so each key sits on its own line -------
# json_get SECTION KEY prints KEY inside object SECTION; SECTION "" matches a key anywhere.
json_get() {
    tr ',{}' '\n\n\n' < "$MANIFEST_FILE" | awk -v sec="$1" -v key="$2" '
        /^[ \t]*$/ { next }
        /^[ \t]*"[^"]+"[ \t]*:[ \t]*$/ { s = $0; sub(/^[ \t]*"/, "", s); sub(/".*$/, "", s); cur = s; next }
        /^[ \t]*"[^"]+"[ \t]*:/ {
            k = $0; sub(/^[ \t]*"/, "", k); sub(/".*$/, "", k)
            v = $0; sub(/^[ \t]*"[^"]+"[ \t]*:[ \t]*/, "", v); sub(/[ \t\r]*$/, "", v); gsub(/^"|"$/, "", v)
            if ((sec == "" || cur == sec) && k == key) { print v; exit }
        }'
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
MANIFEST_FILE="${TMP}/latest.json"

case "${CODECROMA_MANIFEST_URL:-}" in
    "") ;;
    *) warn "using CODECROMA_MANIFEST_URL override (test hook): ${CODECROMA_MANIFEST_URL}" ;;
esac
log "fetching latest release manifest..."
curl -fsSL --retry 3 --connect-timeout 10 --max-time 30 "$MANIFEST_URL" -o "$MANIFEST_FILE" \
    || err "can't reach ${MANIFEST_URL}. Check network, or that a release exists yet."

URL="$(json_get assets "$target")"
SHA256="$(json_get sha256 "$target")"
SIZE="$(json_get size "$target")"
VERSION="$(json_get "" version)"

[ -n "$URL" ] || err "release manifest has no binary for ${target}."
[ "${#SHA256}" -eq 64 ] || err "release manifest has no valid SHA-256 for ${target}."
ASSET="$(safe_name "${URL##*/}")"
[ -n "$ASSET" ] || err "could not derive a file name from the manifest URL."
# Pin the download to this repo's release assets unless the test-hook manifest override is set.
if [ -z "${CODECROMA_MANIFEST_URL:-}" ]; then
    case "$URL" in
        "https://github.com/${REPO}/releases/download/"*) ;;
        *) err "the manifest asset URL is not a https://github.com/${REPO}/releases/download/ URL; refusing it." ;;
    esac
    case "$URL" in
        */../*|*/..|*%2[eE]*) err "the manifest asset URL contains a path traversal; refusing it." ;;
    esac
fi

# --- already installed? ---------------------------------------------------------
installed_version=""
installed_path=""
if [ -f "$STATE_FILE" ]; then
    installed_version="$(sed -n 's/^version=//p' "$STATE_FILE" | head -n 1)"
    installed_path="$(sed -n 's/^path=//p' "$STATE_FILE" | head -n 1)"
fi
if [ "$FORCE" -eq 0 ] && [ -n "$VERSION" ] && [ "$installed_version" = "$VERSION" ] \
    && [ -n "$installed_path" ] && [ -e "$installed_path" ]; then
    log "CodeChroma ${VERSION} is already installed at ${installed_path} (use --force to reinstall)."
    exit 0
fi

# --- download into a private temp dir (never ~/Downloads) -------------------------
DEST="${TMP}/${ASSET}"
download() {
    curl -fsSL --retry 3 --connect-timeout 10 --speed-limit 1024 --speed-time 30 \
        --max-filesize "$MAX_BYTES" "$URL" -o "$DEST" || err "download failed from ${URL}"
    actual_size="$(wc -c < "$DEST" | tr -d ' ')"
    [ "$actual_size" -le "$MAX_BYTES" ] || { rm -f "$DEST"; err "download exceeds ${MAX_BYTES} bytes; refusing oversized asset"; }
    if [ -n "$SIZE" ] && [ "$actual_size" != "$SIZE" ]; then
        rm -f "$DEST"
        err "download size ${actual_size} does not match the manifest size ${SIZE}"
    fi
}
checksum() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$DEST" | awk '{print $1}'
    else shasum -a 256 "$DEST" | awk '{print $1}'; fi
}

log "downloading ${ASSET}"
download
log "verifying SHA-256 checksum"
ACTUAL="$(checksum)"
if [ "$ACTUAL" != "$SHA256" ]; then
    log "checksum mismatch; redownloading once"
    rm -f "$DEST"
    download
    ACTUAL="$(checksum)"
fi
[ "$ACTUAL" = "$SHA256" ] || err "checksum mismatch -- the download is corrupted or tampered with."

# --- provenance: gh attestation verify when available ----------------------------
if command -v "$GH_BIN" >/dev/null 2>&1 && "$GH_BIN" auth status >/dev/null 2>&1; then
    log "verifying build provenance (gh attestation verify)"
    "$GH_BIN" attestation verify "$DEST" --repo "$REPO" --signer-workflow "$SIGNER_WORKFLOW" >/dev/null 2>&1 \
        || err "attestation verification failed: this file was not built by ${REPO}'s release pipeline."
else
    warn "gh is not installed or not logged in: only the SHA-256 checksum was verified, not build provenance (attestation)."
    warn "install and log in to the GitHub CLI for full verification: https://cli.github.com"
fi
warn "the app's in-app updates are verified by their SHA-256 checksum only (they are not signed or attested)."

# --- install by platform -------------------------------------------------------
remember() { # path
    mkdir -p "$STATE_DIR"
    printf 'version=%s\npath=%s\nscope=%s\nflavor=%s\n' "$VERSION" "$1" "$INSTALL_SCOPE" "$APP_FLAVOR" > "$STATE_FILE"
    log "your settings and recent projects are kept (an older Electron build's user data is imported on first launch)."
}

quit_running_app() {
    if command -v pgrep >/dev/null 2>&1 && { pgrep -x CodeChroma >/dev/null 2>&1 || pgrep -x CodeChroma.Shell.App >/dev/null 2>&1; }; then
        warn "CodeChroma is running; asking it to quit before replacing it."
        osascript -e 'tell application "CodeChroma" to quit' >/dev/null 2>&1 || true
        sleep 2
    fi
}

# swap_dir NEW FINAL: move FINAL aside, move NEW in, roll back if that fails, then drop the old copy.
swap_dir() {
    new="$1"; final="$2"; old="${final}.old-$$"
    if [ -e "$final" ]; then
        mv "$final" "$old" || { rm -rf "$new"; err "could not move the existing app aside; it was left untouched."; }
    fi
    if ! mv "$new" "$final"; then
        [ ! -e "$old" ] || mv "$old" "$final"
        rm -rf "$new"
        err "could not put the new app in place; the previous version was restored."
    fi
    rm -rf "$old"
}

case "$os" in
    macos)
        need ditto
        mkdir -p "${TMP}/extract"
        ditto -x -k "$DEST" "${TMP}/extract" || err "could not unpack the downloaded app package."
        SRC_APP="${TMP}/extract/CodeChroma.app"
        [ -d "$SRC_APP" ] || err "CodeChroma.app not found in the downloaded package."
        quit_running_app
        mkdir -p "$APP_DIR"
        cp -R "$SRC_APP" "${APP_DIR}/CodeChroma.app.new-$$" \
            || { rm -rf "${APP_DIR}/CodeChroma.app.new-$$"; err "copy failed; the installed app was left untouched."; }
        swap_dir "${APP_DIR}/CodeChroma.app.new-$$" "${APP_DIR}/CodeChroma.app"
        remember "${APP_DIR}/CodeChroma.app"
        log "done. launch with:  open ${APP_DIR}/CodeChroma.app"
        ;;
    linux)
        if command -v ldconfig >/dev/null 2>&1 && ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
            warn "libfuse2 was not found; the AppImage needs it (Debian/Ubuntu: sudo apt install libfuse2)."
        fi
        APP_PATH="${APP_DIR}/CodeChroma.AppImage"
        mkdir -p "$APP_DIR"
        cp "$DEST" "${APP_PATH}.new-$$" \
            || { rm -f "${APP_PATH}.new-$$"; err "copy failed; the installed app was left untouched."; }
        chmod 755 "${APP_PATH}.new-$$"
        mv -f "${APP_PATH}.new-$$" "$APP_PATH" || { rm -f "${APP_PATH}.new-$$"; err "could not replace the installed AppImage."; }
        ENTRY_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/applications"
        mkdir -p "$ENTRY_DIR" "${HOME}/.local/bin"
        printf '[Desktop Entry]\nType=Application\nName=CodeChroma\nComment=Zoomable architecture map of your code\nExec=%s\nTerminal=false\nCategories=Development;\n' \
            "$APP_PATH" > "${ENTRY_DIR}/codechroma.desktop"
        ln -sf "$APP_PATH" "${HOME}/.local/bin/codechroma"
        remember "$APP_PATH"
        log "done. launch with:  ${APP_PATH}  (or: codechroma, if ~/.local/bin is on PATH)"
        warn "The AppImage is installed for this user only; no system directories or package database were changed."
        ;;
esac

# Older installer versions left a copy of the download here; it is no longer needed.
rm -f "${HOME}/Downloads/${ASSET}" "${HOME}/Downloads/${ASSET}.sha256"
