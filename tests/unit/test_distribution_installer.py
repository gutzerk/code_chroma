import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / "distribution" / "install.sh"


def _mock_command(directory: Path, name: str, source: str) -> None:
    command = directory / name
    command.write_text(source, encoding="utf-8")
    command.chmod(0o755)


@pytest.mark.skipif(os.name == "nt" or shutil.which("sh") is None, reason="requires POSIX shell")
@pytest.mark.parametrize(
    ("system", "machine", "target", "asset_name"),
    [
        ("Darwin", "arm64", "macos-arm64", "CodeChroma-1.2.3-arm64.dmg"),
        ("Linux", "x86_64", "linux-appimage", "CodeChroma-1.2.3-x64.AppImage"),
    ],
)
def test_default_install_uses_user_owned_destination_without_sudo(
    tmp_path: Path, system: str, machine: str, target: str, asset_name: str
) -> None:
    home = tmp_path / "home"
    home.mkdir()
    commands = tmp_path / "commands"
    commands.mkdir()
    asset = tmp_path / asset_name
    asset.write_bytes(b"release asset")
    manifest = tmp_path / "latest.json"
    manifest.write_text(
        json.dumps(
            {
                "version": "1.2.3",
                "assets": {target: f"https://example.invalid/{asset_name}"},
                "sha256": {target: hashlib.sha256(asset.read_bytes()).hexdigest()},
            }
        ),
        encoding="utf-8",
    )
    _mock_command(
        commands,
        "curl",
        """#!/bin/sh
out=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    http*|file:*) url="$1"; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  *latest.json) cp "$FIXTURE_MANIFEST" "$out" ;;
  *) cp "$FIXTURE_ASSET" "$out" ;;
esac
""",
    )
    _mock_command(
        commands,
        "uname",
        """#!/bin/sh
case "$1" in
  -s) printf '%s\\n' "$TEST_UNAME_S" ;;
  -m) printf '%s\\n' "$TEST_UNAME_M" ;;
esac
""",
    )
    _mock_command(
        commands,
        "sudo",
        """#!/bin/sh
printf 'sudo called\\n' >> "$SUDO_MARKER"
exit 97
""",
    )
    _mock_command(
        commands,
        "hdiutil",
        """#!/bin/sh
if [ "$1" = attach ]; then
  while [ "$#" -gt 0 ]; do
    if [ "$1" = -mountpoint ]; then mount="$2"; break; fi
    shift
  done
  mkdir -p "$mount/CodeChroma.app"
  printf 'app bundle' > "$mount/CodeChroma.app/Contents"
elif [ "$1" = detach ]; then
  rm -rf "$2"
fi
exit 0
""",
    )
    env = os.environ.copy()
    env.update(
        {
            "HOME": str(home),
            "PATH": str(commands) + os.pathsep + env["PATH"],
            "FIXTURE_MANIFEST": str(manifest),
            "FIXTURE_ASSET": str(asset),
            "CODECROMA_MANIFEST_URL": "https://example.invalid/latest.json",
            "TEST_UNAME_S": system,
            "TEST_UNAME_M": machine,
            "SUDO_MARKER": str(tmp_path / "sudo-called"),
        }
    )

    result = subprocess.run(
        ["sh", str(INSTALLER)],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert not (tmp_path / "sudo-called").exists()
    if system == "Darwin":
        installed = home / "Applications" / "CodeChroma.app" / "Contents"
        assert installed.read_text(encoding="utf-8") == "app bundle"
    else:
        installed = home / "Applications" / "CodeChroma.AppImage"
        assert installed.read_bytes() == b"release asset"
        assert installed.stat().st_mode & 0o111
