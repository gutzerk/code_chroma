import hashlib
import json
import sys

from scripts.gen_distribution_manifest import main


def test_manifest_includes_separate_arm_and_intel_macos_assets(tmp_path, monkeypatch):
    build_dir = tmp_path / "build"
    build_dir.mkdir()
    arm_asset = build_dir / "CodeChroma-1.2.3-arm64.dmg"
    intel_asset = build_dir / "CodeChroma-1.2.3-x64.dmg"
    arm_asset.write_bytes(b"arm")
    intel_asset.write_bytes(b"intel")
    output = tmp_path / "distribution" / "latest.json"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "gen_distribution_manifest.py",
            "1.2.3",
            "--build-dir",
            str(build_dir),
            "--out",
            str(output),
        ],
    )

    main()

    manifest = json.loads(output.read_text(encoding="utf-8"))
    assert manifest["assets"]["macos-arm64"].endswith("/CodeChroma-1.2.3-arm64.dmg")
    assert manifest["assets"]["macos-x64"].endswith("/CodeChroma-1.2.3-x64.dmg")
    assert manifest["sha256"]["macos-arm64"] == hashlib.sha256(b"arm").hexdigest()
    assert manifest["sha256"]["macos-x64"] == hashlib.sha256(b"intel").hexdigest()
