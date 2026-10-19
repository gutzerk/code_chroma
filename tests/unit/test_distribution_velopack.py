import hashlib
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PACK_SH = ROOT / "distribution" / "velopack" / "pack.sh"
PACK_PS1 = ROOT / "distribution" / "velopack" / "pack.ps1"
VERSION = "1.2.3"

# A stand-in for `vpk pack` that records its arguments and writes what Velopack 1.2 writes for the channel.  # noqa: E501
FAKE_VPK = """#!/bin/sh
printf '%s\\n' "$*" > "$VPK_LOG"
out=""; channel=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --outputDir) out="$2"; shift 2 ;;
    --channel) channel="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[ -z "$VPK_EMPTY" ] || exit 0
case "$channel" in
  osx-*) printf 'zip-bytes' > "$out/CodeChroma-$channel-Portable.zip" ;;
  linux-*) printf 'appimage-bytes' > "$out/CodeChroma-$channel.AppImage" ;;
esac
"""


@pytest.fixture
def publish(tmp_path):
    folder = tmp_path / "publish"
    folder.mkdir()
    (folder / "CodeChroma.Shell.App").write_text("exe")
    return folder


def _run_sh(tmp_path, publish, rid, version=VERSION, **env):
    fake = tmp_path / "vpk"
    fake.write_text(FAKE_VPK, newline="\n")
    fake.chmod(0o755)
    base = os.environ.copy()
    base.update({"CODECROMA_VPK_BIN": str(fake), "VPK_LOG": str(tmp_path / "vpk.log"), **env})
    return subprocess.run(
        ["sh", str(PACK_SH), rid, version, str(publish), str(tmp_path / "out")],
        env=base,
        text=True,
        capture_output=True,
        check=False,
    )


needs_sh = pytest.mark.skipif(shutil.which("sh") is None, reason="requires a POSIX shell")


@needs_sh
@pytest.mark.parametrize(
    ("rid", "name", "payload"),
    [
        ("osx-arm64", f"CodeChroma-{VERSION}-osx-arm64.zip", b"zip-bytes"),
        ("osx-x64", f"CodeChroma-{VERSION}-osx-x64.zip", b"zip-bytes"),
        ("linux-x64", f"CodeChroma-{VERSION}-linux-x86_64.AppImage", b"appimage-bytes"),
    ],
)
def test_pack_sh_renames_the_vpk_output_and_writes_a_matching_sidecar(
    tmp_path, publish, rid, name, payload
):
    result = _run_sh(tmp_path, publish, rid)

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "out" / name).read_bytes() == payload
    sidecar = (tmp_path / "out" / f"{name}.sha256").read_text()
    assert sidecar == f"{hashlib.sha256(payload).hexdigest()}  {name}\n"


@needs_sh
@pytest.mark.parametrize(
    ("rid", "expect_no_inst"), [("osx-arm64", True), ("osx-x64", True), ("linux-x64", False)]
)
def test_pack_sh_passes_the_channel_runtime_without_skipping_the_velopack_app_check(
    tmp_path, publish, rid, expect_no_inst
):
    _run_sh(tmp_path, publish, rid)

    args = (tmp_path / "vpk.log").read_text().split()
    assert args[args.index("--channel") + 1] == rid
    assert args[args.index("--runtime") + 1] == rid
    assert "--skipVeloAppCheck" not in args
    assert ("--noInst" in args) == expect_no_inst


@needs_sh
@pytest.mark.parametrize(
    ("rid", "icon"),
    [("osx-arm64", "icon.icns"), ("osx-x64", "icon.icns"), ("linux-x64", "icon.png")],
)
def test_pack_sh_passes_the_platform_icon_to_vpk(tmp_path, publish, rid, icon):
    _run_sh(tmp_path, publish, rid)

    args = (tmp_path / "vpk.log").read_text().split()
    assert Path(args[args.index("--icon") + 1]).name == icon
    assert (ROOT / "dotnet" / "CodeChroma.Shell.App" / "Assets" / icon).is_file()


@needs_sh
def test_pack_sh_fails_loudly_and_lists_the_output_when_vpk_produced_nothing(tmp_path, publish):
    result = _run_sh(tmp_path, publish, "osx-arm64", VPK_EMPTY="1")

    assert result.returncode == 1
    assert "expected exactly one *Portable.zip" in result.stderr
    assert list((tmp_path / "out").glob("*.zip")) == []


@needs_sh
@pytest.mark.parametrize("version", ["v1.2.3", "1.2", "1.2.3; rm -rf /"])
def test_pack_sh_rejects_a_version_that_is_not_plain_semver(tmp_path, publish, version):
    result = _run_sh(tmp_path, publish, "linux-x64", version=version)

    assert result.returncode == 2
    assert not (tmp_path / "vpk.log").exists()


@needs_sh
def test_pack_sh_rejects_an_unknown_runtime_and_a_missing_main_exe(tmp_path, publish):
    unknown = _run_sh(tmp_path, publish, "win-x64")
    (publish / "CodeChroma.Shell.App").unlink()
    missing = _run_sh(tmp_path, publish, "linux-x64")

    assert (unknown.returncode, missing.returncode) == (2, 1)


@pytest.mark.skipif(
    os.name != "nt" or shutil.which("powershell") is None, reason="requires Windows PowerShell"
)
def test_pack_ps1_renames_the_setup_and_portable_zip_and_writes_sidecars(tmp_path):
    publish = tmp_path / "publish"
    publish.mkdir()
    (publish / "CodeChroma.Shell.App.exe").write_text("exe")
    fake = tmp_path / "vpk.cmd"
    fake.write_text(
        "@echo off\r\n"
        ":next\r\n"
        'if "%1"=="--outputDir" set OUT=%2\r\n'
        "shift\r\n"
        'if not "%1"=="" goto next\r\n'
        'echo setup> "%OUT%\\CodeChroma-win-x64-Setup.exe"\r\n'
        'echo portable> "%OUT%\\CodeChroma-win-x64-Portable.zip"\r\n'
    )

    result = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(PACK_PS1),
            "-Version",
            VERSION,
            "-PublishDir",
            str(publish),
            "-OutDir",
            str(tmp_path / "out"),
            "-Vpk",
            str(fake),
        ],
        text=True,
        capture_output=True,
        check=False,
    )

    out = tmp_path / "out"
    assert result.returncode == 0, result.stdout + result.stderr
    installer = out / f"CodeChroma-{VERSION}-win-x64-Installer.exe"
    update = out / f"CodeChroma-{VERSION}-win-x64.zip"
    assert installer.read_bytes().startswith(b"setup")
    assert (
        out / f"{update.name}.sha256"
    ).read_text() == f"{hashlib.sha256(update.read_bytes()).hexdigest()}  {update.name}\n"
