#!/bin/sh
set -eu

MANIFEST_URL="https://github.com/gutzerk/code_chroma/releases/latest/download/latest.json"

fail() {
  echo "CodeChroma installer: $*" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin)
    os="macos"
    case "$(uname -m)" in
      arm64|aarch64) target="macos-arm64" ;;
      x86_64|amd64) target="macos-x64" ;;
      *) fail "Unsupported macOS architecture: $(uname -m)." ;;
    esac
    ;;
  Linux)
    os="linux"
    case "$(uname -m)" in
      x86_64|amd64)
        if [ -f /etc/debian_version ] && command -v dpkg >/dev/null 2>&1; then
          target="linux-x64"
        else
          target="linux-appimage"
        fi
        ;;
      *) fail "Unsupported Linux architecture: $(uname -m). Only x64 is currently available." ;;
    esac
    ;;
  *)
    fail "Unsupported operating system: $(uname -s). This script supports macOS and Linux."
    ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl is required but was not found."

if command -v jq >/dev/null 2>&1; then
  manifest_value() {
    jq -er --arg target "$target" ".${1}[\$target] | strings | select(length > 0)" "$manifest"
  }
elif command -v python3 >/dev/null 2>&1; then
  manifest_value() {
    python3 - "$manifest" "$1" "$target" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)
value = manifest[sys.argv[2]][sys.argv[3]]
if not isinstance(value, str) or not value:
    raise SystemExit("Manifest value is missing or invalid")
print(value)
PY
  }
elif command -v ruby >/dev/null 2>&1; then
  manifest_value() {
    ruby -rjson -e 'puts JSON.parse(File.read(ARGV[0])).fetch(ARGV[1]).fetch(ARGV[2])' \
      "$manifest" "$1" "$target"
  }
else
  fail "A JSON parser is required: install jq, Python 3, or Ruby and try again."
fi

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/codechroma-install.XXXXXX")" ||
  fail "Could not create a temporary directory."
mountpoint=""

cleanup() {
  if [ -n "$mountpoint" ] && [ -d "$mountpoint" ]; then
    hdiutil detach "$mountpoint" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$tmpdir"
}
trap cleanup EXIT HUP INT TERM

manifest="$tmpdir/latest.json"
if ! curl --fail --location --silent --show-error "$MANIFEST_URL" --output "$manifest"; then
  fail "Could not download the latest release manifest from GitHub."
fi

if ! asset_url="$(manifest_value assets)"; then
  fail "The release manifest has no installer asset for $target."
fi
if ! expected_sha="$(manifest_value sha256)"; then
  fail "The release manifest has no SHA-256 checksum for $target."
fi
case "$asset_url" in
  "https://github.com/gutzerk/code_chroma/releases/download/"*) ;;
  *) fail "The release manifest contains an unexpected installer URL." ;;
esac
case "$target:$asset_url" in
  macos-arm64:https://github.com/gutzerk/code_chroma/releases/download/*.dmg|\
  macos-x64:https://github.com/gutzerk/code_chroma/releases/download/*.dmg|\
  linux-x64:https://github.com/gutzerk/code_chroma/releases/download/*.deb|\
  linux-appimage:https://github.com/gutzerk/code_chroma/releases/download/*.AppImage) ;;
  *) fail "The release manifest contains an installer with an unexpected file type for $target." ;;
esac
case "$expected_sha" in
  *[!0123456789abcdefABCDEF]*) fail "The release manifest contains an invalid SHA-256 checksum." ;;
esac
[ "${#expected_sha}" -eq 64 ] || fail "The release manifest contains an invalid SHA-256 checksum."

if [ "$os" = "macos" ]; then
  installer="$tmpdir/CodeChroma.dmg"
elif [ "$target" = "linux-x64" ]; then
  installer="$tmpdir/CodeChroma.deb"
else
  installer="$tmpdir/CodeChroma.AppImage"
fi

if ! curl --fail --location --silent --show-error "$asset_url" --output "$installer"; then
  fail "Could not download the installer from the latest release."
fi

if command -v shasum >/dev/null 2>&1; then
  actual_sha="$(shasum -a 256 "$installer" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  actual_sha="$(sha256sum "$installer" | awk '{print $1}')"
else
  fail "No SHA-256 utility was found (shasum or sha256sum)."
fi
if [ "$(printf '%s' "$actual_sha" | tr '[:upper:]' '[:lower:]')" != \
     "$(printf '%s' "$expected_sha" | tr '[:upper:]' '[:lower:]')" ]; then
  fail "SHA-256 verification failed. The installer was not run."
fi
echo "Verified installer SHA-256."

if [ "$os" = "macos" ]; then
  command -v hdiutil >/dev/null 2>&1 || fail "hdiutil is required to install the macOS disk image."
  mountpoint="$tmpdir/mount"
  mkdir "$mountpoint"
  if ! hdiutil attach "$installer" -nobrowse -readonly -mountpoint "$mountpoint" >/dev/null; then
    fail "Could not mount the downloaded macOS disk image."
  fi
  app="$mountpoint/CodeChroma.app"
  [ -d "$app" ] || fail "The disk image does not contain CodeChroma.app."
  if [ -w /Applications ]; then
    if ! ditto "$app" /Applications/CodeChroma.app; then
      fail "Could not copy CodeChroma.app to /Applications."
    fi
  elif command -v sudo >/dev/null 2>&1; then
    if ! sudo ditto "$app" /Applications/CodeChroma.app; then
      fail "Could not copy CodeChroma.app to /Applications."
    fi
  else
    fail "Write access to /Applications or sudo is required to install CodeChroma."
  fi
  echo "CodeChroma was installed to /Applications/CodeChroma.app."
elif [ -f /etc/debian_version ] && command -v dpkg >/dev/null 2>&1; then
  if [ "$(id -u)" -eq 0 ]; then
    if command -v apt-get >/dev/null 2>&1; then
      if ! apt-get install -y "$installer"; then
        fail "Debian package installation failed."
      fi
    else
      if ! dpkg -i "$installer"; then
        fail "Debian package installation failed."
      fi
    fi
  elif command -v sudo >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      if ! sudo apt-get install -y "$installer"; then
        fail "Debian package installation failed."
      fi
    else
      if ! sudo dpkg -i "$installer"; then
        fail "Debian package installation failed."
      fi
    fi
  else
    fail "sudo or root access is required to install the Debian package."
  fi
  echo "CodeChroma was installed."
else
  [ -n "${HOME:-}" ] || fail "HOME is not set; cannot install the AppImage."
  install_dir="$HOME/.local/bin"
  mkdir -p "$install_dir"
  if ! cp "$installer" "$install_dir/codechroma" || ! chmod +x "$install_dir/codechroma"; then
    fail "Could not install the AppImage to $install_dir."
  fi
  echo "CodeChroma AppImage was installed to $install_dir/codechroma."
fi
