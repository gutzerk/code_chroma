import hashlib
import json
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / "distribution" / "install.sh"

pytestmark = pytest.mark.skipif(shutil.which("sh") is None, reason="requires a POSIX shell")

CURL = """#!/bin/sh
out=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    http*|file:*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" >> "$CURL_LOG"
case "$url" in
  *latest.json) cp "$FIXTURE_MANIFEST" "$out" ;;
  *)
    n=0
    [ -f "$CORRUPT_STATE" ] && n="$(cat "$CORRUPT_STATE")"
    if [ "$n" -lt "$CORRUPT_FIRST" ]; then
      printf '%s' "$((n + 1))" > "$CORRUPT_STATE"
      tr 'a-z' 'A-Z' < "$FIXTURE_ASSET" > "$out"
    else
      cp "$FIXTURE_ASSET" "$out"
    fi
    ;;
esac
"""

UNAME = """#!/bin/sh
case "$1" in
  -s) printf '%s\\n' "$TEST_UNAME_S" ;;
  -m) printf '%s\\n' "$TEST_UNAME_M" ;;
esac
"""

LOGGING_SUDO = """#!/bin/sh
printf 'sudo %s\\n' "$*" >> "$SUDO_LOG"
exit 0
"""

LOGGING_APT = """#!/bin/sh
printf 'apt-get %s\\n' "$*" >> "$SUDO_LOG"
exit 0
"""

HDIUTIL = """#!/bin/sh
if [ "$1" = attach ]; then
  while [ "$#" -gt 0 ]; do
    if [ "$1" = -mountpoint ]; then mount="$2"; break; fi
    shift
  done
  mkdir -p "$mount/CodeChroma.app"
  printf '%s' "$APP_PAYLOAD" > "$mount/CodeChroma.app/Contents"
elif [ "$1" = detach ]; then
  rm -rf "$2"
fi
exit 0
"""

FAILING_CP = """#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    *.new-*) if [ -n "$FAIL_COPY" ]; then exit 1; fi ;;
  esac
done
exec /bin/cp "$@"
"""

GH = """#!/bin/sh
printf 'gh %s\\n' "$*" >> "$GH_LOG"
case "$1" in
  auth) exit 0 ;;
  attestation) exit "${GH_VERIFY_EXIT:-0}" ;;
esac
exit 0
"""

PGREP = """#!/bin/sh
[ -n "$APP_RUNNING" ]
"""

OSASCRIPT = """#!/bin/sh
printf 'osascript %s\\n' "$*" >> "$SUDO_LOG"
exit 0
"""

DITTO = """#!/bin/sh
# ditto -x -k ARCHIVE DEST: unpack the dotnet app zip as a CodeChroma.app bundle.
dest="$4"
mkdir -p "$dest/CodeChroma.app"
printf '%s' "$APP_PAYLOAD" > "$dest/CodeChroma.app/Contents"
exit 0
"""

LDCONFIG = """#!/bin/sh
printf '%s\\n' "$LDCONFIG_OUT"
"""


@dataclass
class Sandbox:
    root: Path
    system: str
    machine: str
    target: str
    asset_name: str
    payload: bytes = b"release asset"
    version: str = "1.2.3"
    pretty: bool = False
    manifest_extra: dict = field(default_factory=dict)
    env_extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.home = self.root / "home"
        self.home.mkdir(exist_ok=True)
        self.commands = self.root / "commands"
        self.commands.mkdir(exist_ok=True)
        for name, source in {
            "curl": CURL,
            "uname": UNAME,
            "sudo": LOGGING_SUDO,
            "apt-get": LOGGING_APT,
            "hdiutil": HDIUTIL,
            "cp": FAILING_CP,
            "gh": GH,
            "pgrep": PGREP,
            "osascript": OSASCRIPT,
            "ldconfig": LDCONFIG,
            "ditto": DITTO,
        }.items():
            command = self.commands / name
            command.write_text(source, encoding="utf-8", newline="\n")
            command.chmod(0o755)
        self.curl_log = self.root / "curl.log"
        self.sudo_log = self.root / "sudo.log"
        self.gh_log = self.root / "gh.log"
        self.publish(self.payload)

    def publish(self, payload: bytes, version: str | None = None) -> None:
        self.version = version or self.version
        self.payload = payload
        asset = self.root / "asset.bin"
        asset.write_bytes(payload)
        manifest = {
            "version": self.version,
            "assets": {self.target: f"https://example.invalid/{self.asset_name}"},
            "sha256": {self.target: hashlib.sha256(payload).hexdigest()},
            "size": {self.target: len(payload)},
            **self.manifest_extra,
        }
        text = json.dumps(manifest, indent=2 if self.pretty else None)
        (self.root / "latest.json").write_text(text, encoding="utf-8", newline="\n")

    def run(self, *args: str, **env: str) -> subprocess.CompletedProcess:
        base = os.environ.copy()
        base.update(
            {
                "HOME": str(self.home),
                "XDG_CONFIG_HOME": str(self.home / ".config"),
                "XDG_DATA_HOME": str(self.home / ".local" / "share"),
                "XDG_STATE_HOME": str(self.home / ".local" / "state"),
                "PATH": str(self.commands) + os.pathsep + base["PATH"],
                "FIXTURE_MANIFEST": str(self.root / "latest.json"),
                "FIXTURE_ASSET": str(self.root / "asset.bin"),
                "CODECROMA_MANIFEST_URL": "https://example.invalid/latest.json",
                "TEST_UNAME_S": self.system,
                "TEST_UNAME_M": self.machine,
                "CURL_LOG": str(self.curl_log),
                "SUDO_LOG": str(self.sudo_log),
                "GH_LOG": str(self.gh_log),
                "CORRUPT_STATE": str(self.root / "corrupt-count"),
                "CORRUPT_FIRST": "0",
                "APP_PAYLOAD": self.payload.decode(),
                "LDCONFIG_OUT": "libfuse.so.2 (libc6,x86-64) => /lib/libfuse.so.2",
                "CODECROMA_GH_BIN": "gh",
            }
        )
        base.update(self.env_extra)
        base.update(env)
        return subprocess.run(
            ["sh", str(INSTALLER), *args],
            env=base,
            text=True,
            capture_output=True,
            check=False,
        )

    def curl_urls(self) -> list[str]:
        if not self.curl_log.exists():
            return []
        return self.curl_log.read_text(encoding="utf-8").split()

    def asset_downloads(self) -> int:
        return sum(1 for url in self.curl_urls() if not url.endswith("latest.json"))

    def sudo_calls(self) -> str:
        return self.sudo_log.read_text(encoding="utf-8") if self.sudo_log.exists() else ""


PLATFORMS = {
    "mac-arm": ("Darwin", "arm64", "macos-arm64", "CodeChroma-1.2.3-arm64.dmg"),
    "mac-x64": ("Darwin", "x86_64", "macos-x64", "CodeChroma-1.2.3-x64.dmg"),
    "linux-x64": ("Linux", "x86_64", "linux-appimage", "CodeChroma-1.2.3-x64.AppImage"),
}


def make(tmp_path: Path, key: str, **kwargs) -> Sandbox:
    system, machine, target, asset = PLATFORMS[key]
    return Sandbox(tmp_path, system, machine, target, asset, **kwargs)


def installed_path(box: Sandbox) -> Path:
    if box.system == "Darwin":
        return box.home / "Applications" / "CodeChroma.app" / "Contents"
    return box.home / "Applications" / "CodeChroma.AppImage"


@pytest.mark.parametrize("pretty", [False, True], ids=["compact-json", "pretty-json"])
@pytest.mark.parametrize("key", list(PLATFORMS))
def test_default_install_is_user_owned_and_never_uses_sudo(tmp_path, key, pretty):
    box = make(tmp_path, key, pretty=pretty)

    result = box.run()

    assert result.returncode == 0, result.stderr
    assert box.sudo_calls() == ""
    assert installed_path(box).read_bytes() == box.payload
    if key == "linux-x64" and os.name != "nt":
        assert installed_path(box).stat().st_mode & 0o111


def test_linux_user_install_registers_launcher_entry_and_command(tmp_path):
    box = make(tmp_path, "linux-x64")

    result = box.run()

    entry = box.home / ".local" / "share" / "applications" / "codechroma.desktop"
    link = box.home / ".local" / "bin" / "codechroma"
    assert result.returncode == 0, result.stderr
    exec_line = next(line for line in entry.read_text().splitlines() if line.startswith("Exec="))
    assert exec_line.endswith("/home/Applications/CodeChroma.AppImage")
    assert link.is_symlink() or link.exists()


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("mac-arm", ["sudo rm", "sudo cp -R", "/Applications"]),
        ("mac-x64", ["sudo rm", "sudo cp -R", "/Applications"]),
        ("linux-x64", ["apt-get install -y"]),
    ],
)
def test_system_scope_explains_then_uses_sudo_and_skips_user_dir(tmp_path, key, expected):
    system, machine, _target, asset = PLATFORMS[key]
    target = "linux-x64" if key == "linux-x64" else PLATFORMS[key][2]
    box = Sandbox(tmp_path, system, machine, target, asset.replace("AppImage", "deb"))

    result = box.run("--system")

    assert result.returncode == 0, result.stderr
    assert "administrator" in result.stdout.lower()
    calls = box.sudo_calls()
    for needle in expected:
        assert needle in calls
    assert not (box.home / "Applications").exists()


@pytest.mark.parametrize(
    ("system", "machine"),
    [("Linux", "aarch64"), ("Linux", "i686"), ("Darwin", "ppc"), ("FreeBSD", "amd64"),
     ("MINGW64_NT-10.0", "x86_64")],
)
def test_unsupported_platform_fails_before_any_download(tmp_path, system, machine):
    box = Sandbox(tmp_path, system, machine, "macos-arm64", "CodeChroma-1.2.3-arm64.dmg")

    result = box.run()

    assert result.returncode != 0
    assert "unsupported" in result.stderr or "no CodeChroma build" in result.stderr
    assert box.curl_urls() == []


def test_manifest_without_this_target_is_rejected(tmp_path):
    box = make(tmp_path, "mac-arm")
    box.target = "macos-x64"
    box.publish(b"x")

    result = box.run()

    assert result.returncode != 0
    assert "no binary" in result.stderr
    assert not (box.home / "Applications").exists()


def test_checksum_mismatch_redownloads_once_then_installs(tmp_path):
    box = make(tmp_path, "linux-x64")

    result = box.run(CORRUPT_FIRST="1")

    assert result.returncode == 0, result.stderr
    assert box.asset_downloads() == 2
    assert installed_path(box).read_bytes() == box.payload


@pytest.mark.parametrize("key", ["mac-arm", "linux-x64"])
def test_persistent_checksum_mismatch_installs_nothing(tmp_path, key):
    box = make(tmp_path, key)

    result = box.run(CORRUPT_FIRST="5")

    assert result.returncode != 0
    assert "checksum" in result.stderr
    assert box.asset_downloads() == 2
    assert not (box.home / "Applications").exists()


@pytest.mark.parametrize("key", ["mac-arm", "linux-x64"])
def test_oversize_download_is_refused(tmp_path, key):
    box = make(tmp_path, key)

    result = box.run(CODECROMA_MAX_BYTES="4")

    assert result.returncode != 0
    assert "exceeds" in result.stderr
    assert not (box.home / "Applications").exists()


def test_manifest_size_that_disagrees_with_download_is_refused(tmp_path):
    box = make(tmp_path, "linux-x64")
    box.manifest_extra = {"size": {box.target: 3}}
    box.publish(box.payload)

    result = box.run()

    assert result.returncode != 0
    assert "size" in result.stderr
    assert not installed_path(box).exists()


def test_same_version_is_skipped_unless_forced(tmp_path):
    box = make(tmp_path, "linux-x64")
    assert box.run().returncode == 0
    first_downloads = box.asset_downloads()

    again = box.run()
    forced = box.run("--force")

    assert again.returncode == 0
    assert "already installed" in again.stdout
    assert box.asset_downloads() == first_downloads + 1
    assert forced.returncode == 0


def test_newer_version_replaces_the_installed_one(tmp_path):
    box = make(tmp_path, "linux-x64")
    assert box.run().returncode == 0
    box.publish(b"newer release", version="1.3.0")

    result = box.run()

    assert result.returncode == 0, result.stderr
    assert installed_path(box).read_bytes() == b"newer release"


@pytest.mark.parametrize("key", ["mac-arm", "linux-x64"])
def test_failed_copy_keeps_the_old_app_intact(tmp_path, key):
    box = make(tmp_path, key)
    assert box.run().returncode == 0
    box.publish(b"newer release", version="1.3.0")

    result = box.run(FAIL_COPY="1", APP_PAYLOAD="newer release")

    assert result.returncode != 0
    assert installed_path(box).read_bytes() == b"release asset"
    leftovers = [p.name for p in (box.home / "Applications").iterdir()]
    assert not any(".new-" in name or ".old-" in name for name in leftovers)


def test_stale_downloads_copy_from_older_installers_is_removed(tmp_path):
    box = make(tmp_path, "linux-x64")
    downloads = box.home / "Downloads"
    downloads.mkdir()
    stale = downloads / box.asset_name
    stale.write_bytes(b"stale")

    result = box.run()

    assert result.returncode == 0, result.stderr
    assert not stale.exists()


def test_installer_downloads_into_temp_not_downloads(tmp_path):
    box = make(tmp_path, "linux-x64")

    result = box.run()

    assert result.returncode == 0, result.stderr
    assert not (box.home / "Downloads").exists()


def test_running_mac_app_is_asked_to_quit_before_replacing(tmp_path):
    box = make(tmp_path, "mac-arm")

    result = box.run(APP_RUNNING="1")

    assert result.returncode == 0, result.stderr
    assert "osascript" in box.sudo_calls()


def test_missing_libfuse_warns_but_installs(tmp_path):
    box = make(tmp_path, "linux-x64")

    result = box.run(LDCONFIG_OUT="")

    assert result.returncode == 0, result.stderr
    assert "libfuse2" in result.stdout + result.stderr


def test_attestation_is_verified_when_gh_is_available(tmp_path):
    box = make(tmp_path, "linux-x64")

    result = box.run()

    calls = box.gh_log.read_text()
    assert result.returncode == 0, result.stderr
    assert "attestation verify" in calls
    assert "gutzerk/code_chroma" in calls


def test_failed_attestation_blocks_the_install(tmp_path):
    box = make(tmp_path, "linux-x64")

    result = box.run(GH_VERIFY_EXIT="1")

    assert result.returncode != 0
    assert "attestation" in result.stderr
    assert not installed_path(box).exists()


def test_without_gh_the_installer_warns_that_only_sha256_was_checked(tmp_path):
    box = make(tmp_path, "linux-x64")

    result = box.run(CODECROMA_GH_BIN="definitely-not-installed-gh")

    assert result.returncode == 0, result.stderr
    assert "SHA-256" in result.stdout + result.stderr
    assert installed_path(box).exists()


@pytest.mark.parametrize("key", ["mac-arm", "linux-x64"])
def test_uninstall_removes_the_app_but_keeps_user_data(tmp_path, key):
    box = make(tmp_path, key)
    assert box.run().returncode == 0
    data = box.home / ".codechroma"
    data.mkdir()
    (data / "assistant-settings.json").write_text("{}")

    result = box.run("--uninstall")

    assert result.returncode == 0, result.stderr
    assert not installed_path(box).exists()
    assert (data / "assistant-settings.json").exists()
    assert box.asset_downloads() == 1


@pytest.mark.parametrize(
    ("key", "data_dir"),
    [
        ("mac-arm", Path("Library") / "Application Support" / "CodeChroma"),
        ("linux-x64", Path(".config") / "CodeChroma"),
    ],
)
def test_purge_also_removes_user_data(tmp_path, key, data_dir):
    box = make(tmp_path, key)
    assert box.run().returncode == 0
    for directory in (box.home / data_dir, box.home / ".codechroma"):
        directory.mkdir(parents=True)
        (directory / "settings.json").write_text("{}")

    result = box.run("--uninstall", "--purge")

    assert result.returncode == 0, result.stderr
    assert not (box.home / data_dir).exists()
    assert not (box.home / ".codechroma").exists()


def test_linux_uninstall_removes_launcher_entry_and_command(tmp_path):
    box = make(tmp_path, "linux-x64")
    assert box.run().returncode == 0

    result = box.run("--uninstall")

    assert result.returncode == 0, result.stderr
    assert not (box.home / ".local" / "share" / "applications" / "codechroma.desktop").exists()
    assert not (box.home / ".local" / "bin" / "codechroma").is_symlink()


def test_uninstall_when_nothing_is_installed_is_a_clean_noop(tmp_path):
    box = make(tmp_path, "linux-x64")

    result = box.run("--uninstall")

    assert result.returncode == 0, result.stderr
    assert "not installed" in result.stdout.lower()


def test_unknown_option_prints_usage(tmp_path):
    box = make(tmp_path, "linux-x64")

    result = box.run("--bogus")

    assert result.returncode != 0
    assert "usage" in result.stderr.lower()


def test_installer_has_no_python_dependency():
    text = INSTALLER.read_text(encoding="utf-8")

    assert "python3" not in text
    assert "python " not in text


DOTNET_PLATFORMS = {
    "mac-arm": ("Darwin", "arm64", "dotnet-macos-arm64", "CodeChroma-1.2.3-osx-arm64.zip"),
    "mac-x64": ("Darwin", "x86_64", "dotnet-macos-x64", "CodeChroma-1.2.3-osx-x64.zip"),
    "linux-x64": ("Linux", "x86_64", "dotnet-linux-x64", "CodeChroma-1.2.3-linux-x86_64.AppImage"),
}


def make_dotnet(tmp_path: Path, key: str, **kwargs) -> Sandbox:
    system, machine, target, asset = DOTNET_PLATFORMS[key]
    return Sandbox(tmp_path, system, machine, target, asset, **kwargs)


@pytest.mark.parametrize("key", list(DOTNET_PLATFORMS))
def test_dotnet_flavor_installs_per_user_at_the_same_path_as_the_electron_app(tmp_path, key):
    box = make_dotnet(tmp_path, key)

    result = box.run("--dotnet")

    assert result.returncode == 0, result.stderr
    assert box.sudo_calls() == ""
    assert installed_path(box).read_bytes() == box.payload
    assert "flavor=dotnet" in (box.home / ".local" / "state" / "codechroma" / "installed").read_text()  # noqa: E501


@pytest.mark.parametrize("key", list(DOTNET_PLATFORMS))
def test_dotnet_flavor_says_updates_are_checksum_only(tmp_path, key):
    box = make_dotnet(tmp_path, key)

    result = box.run("--dotnet")

    assert "SHA-256 checksum only" in result.stderr + result.stdout
    assert "user-data folder" in result.stdout


def test_the_app_environment_variable_selects_the_dotnet_flavor(tmp_path):
    box = make_dotnet(tmp_path, "linux-x64")

    result = box.run(CODECROMA_APP="dotnet")

    assert result.returncode == 0, result.stderr
    assert installed_path(box).read_bytes() == box.payload


def test_dotnet_flavor_refuses_system_scope_before_downloading(tmp_path):
    box = make_dotnet(tmp_path, "linux-x64")

    result = box.run("--dotnet", "--system")

    assert result.returncode != 0
    assert "per user only" in result.stderr
    assert box.curl_urls() == []


def test_an_unknown_app_flavor_is_refused(tmp_path):
    box = make_dotnet(tmp_path, "linux-x64")

    result = box.run(CODECROMA_APP="swift")

    assert result.returncode != 0
    assert "unknown app flavor" in result.stderr


@pytest.mark.parametrize("key", ["mac-arm", "linux-x64"])
def test_dotnet_checksum_mismatch_installs_nothing(tmp_path, key):
    box = make_dotnet(tmp_path, key)

    result = box.run("--dotnet", CORRUPT_FIRST="5")

    assert result.returncode != 0
    assert "checksum" in result.stderr
    assert not (box.home / "Applications").exists()


def test_a_manifest_without_the_dotnet_target_is_rejected_not_silently_replaced_by_electron(tmp_path):  # noqa: E501
    box = make(tmp_path, "linux-x64")

    result = box.run("--dotnet")

    assert result.returncode != 0
    assert "no binary for dotnet-linux-x64" in result.stderr


def test_the_same_version_of_the_other_flavor_is_not_treated_as_installed(tmp_path):
    electron = make(tmp_path, "linux-x64")
    electron.run()
    dotnet = make_dotnet(tmp_path, "linux-x64")
    dotnet.curl_log.unlink()

    again = dotnet.run("--dotnet")
    skipped = dotnet.run("--dotnet")

    assert again.returncode == 0, again.stderr
    assert installed_path(dotnet).read_bytes() == dotnet.payload
    assert "already installed" in skipped.stdout
    assert dotnet.asset_downloads() == 1


def test_dotnet_uninstall_removes_the_app_and_keeps_user_data(tmp_path):
    box = make_dotnet(tmp_path, "mac-arm")
    box.run("--dotnet")
    data = box.home / "Library" / "Application Support" / "CodeChroma"
    data.mkdir(parents=True)

    result = box.run("--uninstall")

    assert result.returncode == 0, result.stderr
    assert not (box.home / "Applications" / "CodeChroma.app").exists()
    assert data.exists()
