#!/usr/bin/env python3
"""Generate distribution/latest.json -- the install manifest read by distribution/install.{sh,ps1}.

This is the only manifest generator: the release workflow's ``manifest`` job calls it with the
released ``.sha256`` sidecars plus ``gh release view --json assets`` (sizes), and developers call it
on a local directory of packed builds to smoke-test the installers. Both produce identical JSON.

Fields are additive: ``version``/``assets``/``sha256`` are what already-installed versions read;
``size``, ``channel``, ``date`` and ``min_supported_version`` were added later.
"""

from __future__ import annotations

import argparse
import datetime
import fnmatch
import hashlib
import json
import re
import sys
from pathlib import Path

REPO = "gutzerk/code_chroma"

# Target -> artifact glob; test_distribution_consistency.py guards drift from builder and workflow.
# Velopack packages of the C# app (distribution/velopack/pack.*). ``dotnet-windows-x64`` is the
# Setup for fresh installs and ``dotnet-windows-x64-update`` the zip the in-app updater swaps in;
# on macOS the zip (a CodeChroma.app) serves both, and on Linux the AppImage does. The C# app
# is verified by SHA-256 only (no Sigstore), so ``sha256`` is the whole trust for those targets.
PLATFORMS = [
    {"target": "dotnet-windows-x64", "glob": "CodeChroma-*-win-x64-Installer.exe"},
    {"target": "dotnet-windows-x64-update", "glob": "CodeChroma-*-win-x64.zip"},
    {"target": "dotnet-macos-arm64", "glob": "CodeChroma-*-osx-arm64.zip"},
    {"target": "dotnet-macos-x64", "glob": "CodeChroma-*-osx-x64.zip"},
    {"target": "dotnet-linux-x64", "glob": "CodeChroma-*-linux-x86_64.AppImage"},
]

_DIGEST = re.compile(r"[0-9a-f]{64}")


def sha256(path: Path) -> str:
    """Hex digest of a file, streamed (installers are tens of MB)."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _sidecar_digest(sidecar: Path, name: str) -> str:
    digest = sidecar.read_text(encoding="utf-8").strip().split()[0].lower()
    if not _DIGEST.fullmatch(digest):
        raise SystemExit(f"error: invalid SHA-256 digest in sidecar for {name}: {digest!r}")
    return digest


def _candidate_names(build_dir: Path, sidecars: Path, listing: dict[str, int]) -> list[str]:
    names = set(listing)
    if build_dir.is_dir():
        names |= {p.name for p in build_dir.iterdir() if p.is_file() and p.suffix != ".sha256"}
    if sidecars.is_dir():
        names |= {p.name[: -len(".sha256")] for p in sidecars.glob("*.sha256")}
    return sorted(names)


def _entry(name: str, build_dir: Path, sidecars: Path, listing: dict[str, int]) -> tuple[str, int]:
    built = build_dir / name
    sidecar = sidecars / f"{name}.sha256"
    digest = _sidecar_digest(sidecar, name) if sidecar.is_file() else None
    if built.is_file():
        actual = sha256(built)
        if digest is not None and digest != actual:
            raise SystemExit(f"error: sidecar digest mismatch for {name}: {digest} != {actual}")
        digest = actual
    if digest is None:
        raise SystemExit(f"error: no file or sidecar digest available for {name}")
    size = built.stat().st_size if built.is_file() else listing.get(name)
    if size is None:
        raise SystemExit(f"error: no size known for {name} (pass --assets-json)")
    return digest, size


def build_manifest(
    version: str,
    *,
    build_dir: Path,
    sidecars: Path,
    listing: dict[str, int],
    tag: str,
    repo: str,
    channel: str,
    date: str,
    min_supported_version: str,
) -> dict:
    """Assemble the manifest dict for the installers found in the given sources."""
    base = f"https://github.com/{repo}/releases/download/{tag}"
    names = _candidate_names(build_dir, sidecars, listing)
    assets: dict[str, str] = {}
    checksums: dict[str, str] = {}
    sizes: dict[str, int] = {}
    for platform in PLATFORMS:
        target = platform["target"]
        matches = [n for n in names if fnmatch.fnmatch(n, platform["glob"])]
        if not matches:
            print(f"note: no artifact for {target} ({platform['glob']}) -- skipped")
            continue
        name = matches[0]
        checksums[target], sizes[target] = _entry(name, build_dir, sidecars, listing)
        assets[target] = f"{base}/{name}"
    if not assets:
        raise SystemExit(f"error: no installers found under {build_dir}; nothing to manifest")
    return {
        "version": version,
        "channel": channel,
        "date": date,
        "min_supported_version": min_supported_version,
        "assets": assets,
        "sha256": checksums,
        "size": sizes,
    }


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("version", help="Version to write into the manifest, e.g. 1.2.3")
    ap.add_argument("--build-dir", default="dist-dotnet", help="Directory with built installers")
    ap.add_argument("--sidecars", help="Directory with .sha256 sidecars (default: --build-dir)")
    ap.add_argument("--assets-json", help="`gh release view --json assets` output, for sizes")
    ap.add_argument("--tag", help="Release tag used in asset URLs (default: v<version>)")
    ap.add_argument("--repo", default=REPO, help=f"GitHub owner/name (default: {REPO})")
    ap.add_argument("--channel", default="stable", help="Update channel (default: stable)")
    ap.add_argument("--date", help="Release date, YYYY-MM-DD (default: today, UTC)")
    ap.add_argument(
        "--min-supported-version",
        default="0.0.0",
        help="Versions below this should be forced to upgrade (default 0.0.0 = off)",
    )
    ap.add_argument("--out", default="distribution/latest.json", help="Output manifest path")
    args = ap.parse_args(argv)

    version = args.version.lstrip("v")
    build_dir = Path(args.build_dir)
    listing: dict[str, int] = {}
    if args.assets_json:
        data = json.loads(Path(args.assets_json).read_text(encoding="utf-8"))
        listing = {a["name"]: int(a["size"]) for a in data.get("assets", [])}
    manifest = build_manifest(
        version,
        build_dir=build_dir,
        sidecars=Path(args.sidecars) if args.sidecars else build_dir,
        listing=listing,
        tag=args.tag or f"v{version}",
        repo=args.repo,
        channel=args.channel,
        date=args.date or datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d"),
        min_supported_version=args.min_supported_version,
    )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} for v{version}: {', '.join(sorted(manifest['assets']))}")


if __name__ == "__main__":
    main(sys.argv[1:])
