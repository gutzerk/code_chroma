import hashlib
import json
import re
from pathlib import Path

import pytest
from scripts.gen_distribution_manifest import main

VERSION = "1.2.3"
FILES = {
    "macos-arm64": f"CodeChroma-{VERSION}-arm64.dmg",
    "macos-x64": f"CodeChroma-{VERSION}-x64.dmg",
    "windows-x64": f"CodeChroma-{VERSION}-x64-Setup.exe",
    "linux-x64": f"CodeChroma-{VERSION}-x64.deb",
    "linux-appimage": f"CodeChroma-{VERSION}-x64.AppImage",
    "dotnet-windows-x64": f"CodeChroma-{VERSION}-win-x64-Installer.exe",
    "dotnet-windows-x64-update": f"CodeChroma-{VERSION}-win-x64.zip",
    "dotnet-macos-arm64": f"CodeChroma-{VERSION}-osx-arm64.zip",
    "dotnet-macos-x64": f"CodeChroma-{VERSION}-osx-x64.zip",
    "dotnet-linux-x64": f"CodeChroma-{VERSION}-linux-x86_64.AppImage",
}
ELECTRON_TARGETS = ["macos-arm64", "macos-x64", "windows-x64", "linux-x64", "linux-appimage"]
REPO = "gutzerk/code_chroma"


def _populate(directory: Path, names: dict[str, str]) -> dict[str, bytes]:
    directory.mkdir(parents=True, exist_ok=True)
    contents = {}
    for target, name in names.items():
        payload = f"payload for {target}".encode()
        (directory / name).write_bytes(payload)
        contents[target] = payload
    return contents


def _run(*args: str) -> None:
    main(list(args))


def _generate(tmp_path: Path, *extra: str) -> dict:
    out = tmp_path / "out" / "latest.json"
    _run(VERSION, "--build-dir", str(tmp_path / "build"), "--out", str(out), *extra)
    return json.loads(out.read_text(encoding="utf-8"))


@pytest.mark.parametrize("target", list(FILES))
def test_manifest_lists_every_target_with_url_digest_and_size(tmp_path, target):
    contents = _populate(tmp_path / "build", FILES)

    manifest = _generate(tmp_path)

    payload = contents[target]
    assert manifest["assets"][target].endswith(f"/{FILES[target]}")
    assert manifest["sha256"][target] == hashlib.sha256(payload).hexdigest()
    assert manifest["size"][target] == len(payload)


@pytest.mark.parametrize("target", list(FILES))
def test_every_asset_url_is_pinned_to_the_release_tag(tmp_path, target):
    _populate(tmp_path / "build", FILES)

    manifest = _generate(tmp_path)

    expected = f"https://github.com/{REPO}/releases/download/v{VERSION}/{FILES[target]}"
    assert manifest["assets"][target] == expected


def test_manifest_adds_channel_date_and_min_supported_version(tmp_path):
    _populate(tmp_path / "build", FILES)

    manifest = _generate(tmp_path, "--date", "2026-01-02", "--min-supported-version", "1.0.0")

    assert manifest["version"] == VERSION
    assert manifest["channel"] == "stable"
    assert manifest["date"] == "2026-01-02"
    assert manifest["min_supported_version"] == "1.0.0"


def test_manifest_defaults_keep_the_kill_switch_off_and_date_valid(tmp_path):
    _populate(tmp_path / "build", FILES)

    manifest = _generate(tmp_path)

    assert manifest["min_supported_version"] == "0.0.0"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", manifest["date"])


def test_manifest_keeps_the_fields_already_installed_versions_read(tmp_path):
    _populate(tmp_path / "build", FILES)

    manifest = _generate(tmp_path)

    assert {"version", "assets", "sha256"} <= set(manifest)
    assert set(manifest["assets"]) == set(manifest["sha256"]) == set(FILES)


def test_custom_tag_and_repo_flow_into_the_urls(tmp_path):
    _populate(tmp_path / "build", FILES)

    manifest = _generate(tmp_path, "--tag", "code-chroma-v1.2.3", "--repo", "acme/widgets")

    assert manifest["assets"]["linux-appimage"] == (
        f"https://github.com/acme/widgets/releases/download/code-chroma-v1.2.3/{FILES['linux-appimage']}"
    )


def test_ci_mode_from_sidecars_matches_local_mode_from_built_files(tmp_path):
    contents = _populate(tmp_path / "build", FILES)
    sidecars = tmp_path / "sidecars"
    sidecars.mkdir()
    for target, name in FILES.items():
        digest = hashlib.sha256(contents[target]).hexdigest()
        (sidecars / f"{name}.sha256").write_text(f"{digest}  {name}\n")
    listing = tmp_path / "assets.json"
    listing.write_text(
        json.dumps({"assets": [{"name": FILES[t], "size": len(c)} for t, c in contents.items()]})
    )
    local = _generate(tmp_path, "--date", "2026-01-02")
    out = tmp_path / "ci.json"

    _run(VERSION, "--build-dir", str(sidecars), "--sidecars", str(sidecars),
         "--assets-json", str(listing), "--date", "2026-01-02", "--out", str(out))

    assert json.loads(out.read_text(encoding="utf-8")) == local


def test_a_sidecar_with_a_malformed_digest_aborts_generation(tmp_path):
    _populate(tmp_path / "build", FILES)
    sidecars = tmp_path / "sidecars"
    sidecars.mkdir()
    (sidecars / f"{FILES['linux-appimage']}.sha256").write_text("not-a-digest  file\n")

    with pytest.raises(SystemExit) as raised:
        _run(VERSION, "--build-dir", str(tmp_path / "build"), "--sidecars", str(sidecars),
             "--out", str(tmp_path / "x.json"))

    assert "digest" in str(raised.value).lower()


def test_a_sidecar_that_disagrees_with_the_file_aborts_generation(tmp_path):
    _populate(tmp_path / "build", FILES)
    sidecars = tmp_path / "sidecars"
    sidecars.mkdir()
    (sidecars / f"{FILES['linux-appimage']}.sha256").write_text("0" * 64 + "  file\n")

    with pytest.raises(SystemExit) as raised:
        _run(VERSION, "--build-dir", str(tmp_path / "build"), "--sidecars", str(sidecars),
             "--out", str(tmp_path / "x.json"))

    assert "mismatch" in str(raised.value).lower()


def test_missing_installers_skip_their_target_and_none_at_all_fails(tmp_path):
    _populate(tmp_path / "build", {"linux-appimage": FILES["linux-appimage"]})
    manifest = _generate(tmp_path)

    assert set(manifest["assets"]) == {"linux-appimage"}
    with pytest.raises(SystemExit):
        _run(VERSION, "--build-dir", str(tmp_path / "empty"), "--out", str(tmp_path / "e.json"))


def test_a_release_with_only_electron_installers_has_no_dotnet_targets(tmp_path):
    _populate(tmp_path / "build", {t: FILES[t] for t in ELECTRON_TARGETS})

    manifest = _generate(tmp_path)

    assert set(manifest["assets"]) == set(ELECTRON_TARGETS)


@pytest.mark.parametrize("target", ELECTRON_TARGETS)
def test_a_release_carrying_both_flavors_keeps_the_electron_targets_on_the_electron_installers(tmp_path, target):
    _populate(tmp_path / "build", FILES)

    manifest = _generate(tmp_path)

    assert manifest["assets"][target].endswith(f"/{FILES[target]}")
    assert manifest["sha256"][target] == hashlib.sha256(f"payload for {target}".encode()).hexdigest()
