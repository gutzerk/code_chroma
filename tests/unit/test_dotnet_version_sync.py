import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CSPROJ = "dotnet/CodeChroma.Shell.App/CodeChroma.Shell.App.csproj"


def test_the_csharp_app_version_matches_the_author_version():
    author = json.loads((ROOT / "desktop/package.json").read_text("utf-8"))["version"]

    declared = re.search(r"<Version>([^<]+)</Version>", (ROOT / CSPROJ).read_text("utf-8"))

    assert declared is not None and declared.group(1) == author


def test_release_please_bumps_the_csharp_app_version():
    config = json.loads((ROOT / "release-please-config.json").read_text("utf-8"))

    extra = [f for pkg in config["packages"].values() for f in pkg.get("extra-files", [])]

    assert {"type": "xml", "path": CSPROJ, "xpath": "//Project/PropertyGroup/Version"} in extra
