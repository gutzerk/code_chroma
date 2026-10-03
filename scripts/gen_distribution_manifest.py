#!/usr/bin/env python3
"""Generate distribution/latest.json -- the single install manifest used by distribution/
install.sh (macOS/Linux) and install.ps1 (Windows), in the style of herdr.

Reads the just-built installers in desktop/dist and emits one JSON with a version + per-platform
URL/SHA-256 (keyed by the target names the installers look up). The release CI calls this after the
three build jobs and uploads the result as a Release asset so the installers can fetch it from
``.../releases/latest/download/latest.json`` (or from the raw repo copy for local/dev snapshots).

Non-release (local) use: pick a directory and a version to build a manifest for whatever installers
exist there, so install.sh/install.ps1 can be smoke-tested without a real release.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

REPO = "gutzerk/code-chroma"

# Per-platform source glob (inside the build output dir) -> manifest target key -> release URL path.
# Must stay in sync with desktop/electron-builder.yml artifact names and release-please.yml uploads.
PLATFORMS = [
    {
        "target": "macos-arm64",
        "glob": "CodeChroma-*-arm64.dmg",
        "url": lambda v, name: (
            f"https://github.com/{REPO}/releases/download/v{v}/{name}"
        ),
    },
    {
        "target": "macos-x64",
        "glob": "CodeChroma-*-x64.dmg",
        "url": lambda v, name: (
            f"https://github.com/{REPO}/releases/download/v{v}/{name}"
        ),
    },
    {
        "target": "windows-x64",
        "glob": "CodeChroma-*-Setup.exe",
        "url": lambda v, name: (
            f"https://github.com/{REPO}/releases/download/v{v}/{name}"
        ),
    },
    {
        "target": "linux-x64",
        "glob": "CodeChroma-*-x64.deb",
        "url": lambda v, name: (
            f"https://github.com/{REPO}/releases/download/v{v}/{name}"
        ),
    },
    {
        "target": "linux-appimage",
        "glob": "CodeChroma-*-x64.AppImage",
        "url": lambda v, name: (
            f"https://github.com/{REPO}/releases/download/v{v}/{name}"
        ),
    },
]


def sha256(path: Path) -> str:
    """Hex digest of a file, streamed (installers are tens of MB)."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("version", help="Version to write into the manifest, e.g. 1.2.3")
    ap.add_argument(
        "--build-dir",
        default="desktop/dist",
        help="Directory containing the built installers (default: desktop/dist)",
    )
    ap.add_argument(
        "--out",
        default="distribution/latest.json",
        help="Output manifest path (default: distribution/latest.json)",
    )
    args = ap.parse_args()

    build_dir = Path(args.build_dir)
    version = args.version.lstrip("v")

    assets: dict[str, str] = {}
    checksums: dict[str, str] = {}

    for platform in PLATFORMS:
        target = platform["target"]
        matches = sorted(build_dir.glob(platform["glob"]))
        if not matches:
            print(f"note: no artifact for {target} ({platform['glob']}) -- skipped")
            continue
        name = matches[0].name
        # The post-build .sha256 sidecar duplicates the digest; we hash the artifact directly so the
        # manifest is self-consistent even if a sidecar was missing or stale.
        checksums[target] = sha256(matches[0])
        assets[target] = platform["url"](version, name)

    if not assets:
        raise SystemExit(f"error: no installers found under {build_dir}; nothing to manifest")

    manifest = {
        "version": version,
        "assets": assets,
        "sha256": checksums,
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} for v{version}: {', '.join(sorted(assets))}")


if __name__ == "__main__":
    main()
