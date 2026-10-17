import fnmatch
import re
from pathlib import Path

import pytest
import yaml
from scripts.gen_distribution_manifest import PLATFORMS

ROOT = Path(__file__).resolve().parents[2]
BUILDER = yaml.safe_load((ROOT / "desktop" / "electron-builder.yml").read_text(encoding="utf-8"))
WORKFLOW = (ROOT / ".github" / "workflows" / "release-please.yml").read_text(encoding="utf-8")
UPDATER = (ROOT / "desktop" / "src" / "updater.ts").read_text(encoding="utf-8")
CSHARP_CHECKER = (ROOT / "dotnet" / "CodeChroma.Shell" / "Updater" / "UpdateChecker.cs").read_text(encoding="utf-8")
PACK_PS1 = (ROOT / "distribution" / "velopack" / "pack.ps1").read_text(encoding="utf-8")
PACK_SH = (ROOT / "distribution" / "velopack" / "pack.sh").read_text(encoding="utf-8")
VERSION = "9.8.7"
DOTNET_RIDS = ("osx-arm64", "osx-x64")


def _expand(template: str, **values: str) -> str:
    for key, value in values.items():
        template = template.replace("${" + key + "}", value)
    return template


def _electron_built_names() -> list[str]:
    names = []
    for arch in ("arm64", "x64"):
        names.append(_expand(BUILDER["mac"]["artifactName"], version=VERSION, arch=arch, ext="dmg"))
    names.append(_expand(BUILDER["win"]["artifactName"], version=VERSION, arch="x64", ext="exe"))
    for ext in ("deb", "AppImage"):
        template = BUILDER["linux"]["artifactName"]
        names.append(_expand(template, version=VERSION, arch="x64", ext=ext))
    return names


def _built_names() -> list[str]:
    return _electron_built_names() + _dotnet_built_names()


def _dotnet_built_names() -> list[str]:
    """The names pack.ps1 / pack.sh give the Velopack outputs, with the script variables filled in."""
    names = [m.replace("$Version", VERSION) for m in re.findall(r'"(CodeChroma-\$Version-[^"]+)"', PACK_PS1)]
    for template in re.findall(r'name="(CodeChroma-\$\{version\}-[^"]+)"', PACK_SH):
        filled = template.replace("${version}", VERSION)
        names += [filled.replace("${rid}", rid) for rid in DOTNET_RIDS] if "${rid}" in filled else [filled]
    return names


def _csharp_native_suffixes() -> list[str]:
    block = CSHARP_CHECKER.split("NativeSuffixes = new()")[1].split("};")[0]
    return re.findall(r'"(-[^"]+)"', block)


def _workflow_globs() -> set[str]:
    text = WORKFLOW.replace("${{ matrix.arch }}", "@ARCH@").replace("${{ matrix.rid }}", "@RID@")
    globs = set()
    for item in re.findall(r"CodeChroma-[^\s'\"|]+", text):
        for arch in ("arm64", "x64"):
            globs.add(item.replace("@ARCH@", arch))
        for rid in DOTNET_RIDS:
            globs.add(item.replace("@RID@", rid))
    return globs


def _updater_suffixes() -> list[str]:
    return re.findall(r'suffix:\s*"([^"]+)"', UPDATER)


@pytest.mark.parametrize("name", _built_names())
def test_every_built_name_maps_to_exactly_one_manifest_glob(name):
    matches = [p["target"] for p in PLATFORMS if fnmatch.fnmatch(name, p["glob"])]

    assert len(matches) == 1, f"{name} matched {matches}"


@pytest.mark.parametrize("platform", PLATFORMS, ids=lambda p: p["target"])
def test_every_manifest_glob_matches_a_built_name(platform):
    matched = [n for n in _built_names() if fnmatch.fnmatch(n, platform["glob"])]

    assert matched, f"no electron-builder output matches {platform['glob']}"


@pytest.mark.parametrize("name", _built_names())
def test_the_release_workflow_uploads_and_hashes_every_built_name(name):
    globs = _workflow_globs()

    uploaded = [g for g in globs if fnmatch.fnmatch(name, g)]
    sidecar = [g for g in globs if fnmatch.fnmatch(f"{name}.sha256", g)]

    assert uploaded, f"{name} not covered by a workflow glob"
    assert sidecar, f"{name}.sha256 not covered by a workflow glob"


def test_updater_suffixes_all_match_a_built_name():
    suffixes = _updater_suffixes()

    assert len(suffixes) == 4
    for suffix in suffixes:
        assert any(n.endswith(suffix) for n in _built_names()), suffix


def test_the_windows_asset_is_versioned_and_still_accepted_by_the_updater():
    windows = _expand(BUILDER["win"]["artifactName"], version=VERSION, arch="x64", ext="exe")

    assert windows == f"CodeChroma-{VERSION}-x64-Setup.exe"
    assert '.endsWith("-x64-Setup.exe")' in UPDATER
    assert '"CodeChroma-Setup.exe"' in UPDATER  # releases published before the rename


def test_linux_artifact_arch_stays_literal_x64():
    assert "-x64." in BUILDER["linux"]["artifactName"]
    assert "${arch}" not in BUILDER["linux"]["artifactName"]


def test_the_pack_scripts_produce_the_five_dotnet_assets():
    names = _dotnet_built_names()

    assert sorted(names) == sorted(
        [
            f"CodeChroma-{VERSION}-win-x64-Installer.exe",
            f"CodeChroma-{VERSION}-win-x64.zip",
            f"CodeChroma-{VERSION}-osx-arm64.zip",
            f"CodeChroma-{VERSION}-osx-x64.zip",
            f"CodeChroma-{VERSION}-linux-x86_64.AppImage",
        ]
    )


@pytest.mark.parametrize("name", _dotnet_built_names())
def test_installed_electron_updaters_never_select_a_dotnet_asset(name):
    # desktop/src/updater.ts selects CodeChroma-* assets by these suffixes (and -Setup.exe on Windows).
    assert not any(name.endswith(suffix) for suffix in _updater_suffixes())


@pytest.mark.parametrize("name", _electron_built_names())
def test_the_csharp_updater_matches_no_electron_name_as_a_native_package(name):
    assert not any(name.endswith(suffix) for suffix in _csharp_native_suffixes())


@pytest.mark.parametrize("name", [n for n in _dotnet_built_names() if not n.endswith("-Installer.exe")])
def test_the_csharp_updater_selects_every_dotnet_update_payload_by_exactly_one_suffix(name):
    matching = [s for s in _csharp_native_suffixes() if name.endswith(s)]

    assert len(matching) == 1, f"{name} matched {matching}"


def test_the_csharp_updater_has_one_native_suffix_per_platform_and_keeps_the_electron_ones_as_legacy():
    assert len(_csharp_native_suffixes()) == 4
    for suffix in _updater_suffixes():
        assert f'"{suffix}"' in CSHARP_CHECKER


def test_the_windows_fresh_install_asset_is_not_a_setup_exe_the_electron_updater_would_take():
    installer = next(n for n in _dotnet_built_names() if n.endswith("Installer.exe"))

    assert not installer.endswith("-Setup.exe")
