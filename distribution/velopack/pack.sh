#!/bin/sh
# Packs a published CodeChroma.Shell.App folder with Velopack (vpk) for macOS or Linux and renames the outputs.
#
#   pack.sh <osx-arm64|osx-x64|linux-x64> <version> <publish-dir> <out-dir> [main-exe]
#
# Produces, in <out-dir> (plus a .sha256 sidecar each):
#   osx-*:     CodeChroma-<version>-osx-<arch>.zip       the CodeChroma.app bundle, zipped (install.sh unzips it
#                                                        into ~/Applications; the in-app updater swaps the bundle)
#   linux-x64: CodeChroma-<version>-linux-x86_64.AppImage
# The names avoid the Electron suffixes (-arm64.dmg, -x64.dmg, -x64.AppImage) so installed Electron updaters never
# pick them up. scripts/gen_distribution_manifest.py and tests/unit/test_distribution_consistency.py pin them.
# Test hook: CODECROMA_VPK_BIN replaces the vpk executable.
set -eu

[ "$#" -ge 4 ] || { echo "usage: pack.sh <osx-arm64|osx-x64|linux-x64> <version> <publish-dir> <out-dir> [main-exe]" >&2; exit 2; }
rid="$1"; version="$2"; publish="$3"; out="$4"; main_exe="${5:-CodeChroma.Shell.App}"
vpk="${CODECROMA_VPK_BIN:-vpk}"

case "$rid" in
    osx-arm64|osx-x64|linux-x64) ;;
    *) echo "error: unsupported runtime '$rid'" >&2; exit 2 ;;
esac
printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' \
    || { echo "error: version '$version' is not semver (no leading v)" >&2; exit 2; }
[ -e "$publish/$main_exe" ] || { echo "error: $main_exe not found in $publish" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

extra=""
[ "${rid#osx-}" = "$rid" ] || extra="--noInst"
# shellcheck disable=SC2086
"$vpk" pack --packId CodeChroma --packTitle CodeChroma --packVersion "$version" --packDir "$publish" \
    --mainExe "$main_exe" --outputDir "$work" --channel "$rid" --runtime "$rid" $extra

# pick PATTERN: the single matching file in the vpk output, or fail listing what was produced.
pick() {
    count=0; found=""
    for candidate in "$work"/$1; do
        [ -e "$candidate" ] || continue
        count=$((count + 1)); found="$candidate"
    done
    if [ "$count" -ne 1 ]; then
        echo "error: expected exactly one $1 from vpk, found $count (output: $(ls "$work" | tr '\n' ' '))" >&2
        exit 1
    fi
    printf '%s' "$found"
}
checksum() {
    # sha256sum under msys prefixes a backslash to the hash when the path contains one; strip it.
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{sub(/^\\/, "", $1); print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

case "$rid" in
    osx-*) source="$(pick '*Portable.zip')"; name="CodeChroma-${version}-${rid}.zip" ;;
    linux-x64) source="$(pick '*.AppImage')"; name="CodeChroma-${version}-linux-x86_64.AppImage" ;;
esac
cp "$source" "$out/$name"
printf '%s  %s\n' "$(checksum "$out/$name")" "$name" > "$out/$name.sha256"
echo "packed $name"
