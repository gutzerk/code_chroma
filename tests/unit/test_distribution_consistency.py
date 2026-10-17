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
VERSION = "9.8.7"


def _expand(template: str, **values: str) -> str:
    for key, value in values.items():
        template = template.replace("${" + key + "}", value)
    return template


def _built_names() -> list[str]:
    names = []
    for arch in ("arm64", "x64"):
        names.append(_expand(BUILDER["mac"]["artifactName"], version=VERSION, arch=arch, ext="dmg"))
    names.append(_expand(BUILDER["win"]["artifactName"], version=VERSION, arch="x64", ext="exe"))
    for ext in ("deb", "AppImage"):
        template = BUILDER["linux"]["artifactName"]
        names.append(_expand(template, version=VERSION, arch="x64", ext=ext))
    return names


def _workflow_globs() -> set[str]:
    text = WORKFLOW.replace("${{ matrix.arch }}", "@ARCH@")
    globs = set()
    for item in re.findall(r"CodeChroma-[^\s'\"|]+", text):
        for arch in ("arm64", "x64"):
            globs.add(item.replace("@ARCH@", arch))
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


def test_the_windows_asset_keeps_the_name_the_updater_accepts():
    windows = _expand(BUILDER["win"]["artifactName"], version=VERSION, arch="x64", ext="exe")

    assert windows == "CodeChroma-Setup.exe"
    assert '"CodeChroma-Setup.exe"' in UPDATER


def test_linux_artifact_arch_stays_literal_x64():
    assert "-x64." in BUILDER["linux"]["artifactName"]
    assert "${arch}" not in BUILDER["linux"]["artifactName"]
