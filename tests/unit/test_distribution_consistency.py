import fnmatch
import re
from pathlib import Path

import pytest
from scripts.gen_distribution_manifest import PLATFORMS

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github" / "workflows" / "release-please.yml").read_text(encoding="utf-8")
CSHARP_CHECKER = (ROOT / "dotnet" / "CodeChroma.Shell" / "Updater" / "UpdateChecker.cs").read_text(encoding="utf-8")  # noqa: E501
PACK_PS1 = (ROOT / "distribution" / "velopack" / "pack.ps1").read_text(encoding="utf-8")
PACK_SH = (ROOT / "distribution" / "velopack" / "pack.sh").read_text(encoding="utf-8")
VERSION = "9.8.7"
DOTNET_RIDS = ("osx-arm64", "osx-x64")


def _built_names() -> list[str]:
    return _dotnet_built_names()


def _dotnet_built_names() -> list[str]:
    """The names pack.ps1 / pack.sh give the Velopack outputs, with the script variables filled in."""  # noqa: E501
    names = [m.replace("$Version", VERSION) for m in re.findall(r'"(CodeChroma-\$Version-[^"]+)"', PACK_PS1)]  # noqa: E501
    for template in re.findall(r'name="(CodeChroma-\$\{version\}-[^"]+)"', PACK_SH):
        filled = template.replace("${version}", VERSION)
        names += [filled.replace("${rid}", rid) for rid in DOTNET_RIDS] if "${rid}" in filled else [filled]  # noqa: E501
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


@pytest.mark.parametrize("name", _built_names())
def test_every_built_name_maps_to_exactly_one_manifest_glob(name):
    matches = [p["target"] for p in PLATFORMS if fnmatch.fnmatch(name, p["glob"])]

    assert len(matches) == 1, f"{name} matched {matches}"


@pytest.mark.parametrize("platform", PLATFORMS, ids=lambda p: p["target"])
def test_every_manifest_glob_matches_a_built_name(platform):
    matched = [n for n in _built_names() if fnmatch.fnmatch(n, platform["glob"])]

    assert matched, f"no pack script output matches {platform['glob']}"


@pytest.mark.parametrize("name", _built_names())
def test_the_release_workflow_uploads_and_hashes_every_built_name(name):
    globs = _workflow_globs()

    uploaded = [g for g in globs if fnmatch.fnmatch(name, g)]
    sidecar = [g for g in globs if fnmatch.fnmatch(f"{name}.sha256", g)]

    assert uploaded, f"{name} not covered by a workflow glob"
    assert sidecar, f"{name}.sha256 not covered by a workflow glob"


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


@pytest.mark.parametrize("name", [n for n in _dotnet_built_names() if not n.endswith("-Installer.exe")])  # noqa: E501
def test_the_csharp_updater_selects_every_dotnet_update_payload_by_exactly_one_suffix(name):
    matching = [s for s in _csharp_native_suffixes() if name.endswith(s)]

    assert len(matching) == 1, f"{name} matched {matching}"


def test_the_csharp_updater_has_one_native_suffix_per_platform():
    assert len(_csharp_native_suffixes()) == 4
