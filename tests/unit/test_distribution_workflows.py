import json
import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
RELEASE = (WORKFLOWS / "release-please.yml").read_text(encoding="utf-8")
CI = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")
CONFIG = json.loads((ROOT / "release-please-config.json").read_text(encoding="utf-8"))


def _jobs(text: str) -> dict:
    return yaml.safe_load(text)["jobs"]


def _all_workflows() -> list[Path]:
    return sorted(WORKFLOWS.glob("*.yml"))


@pytest.mark.parametrize("path", _all_workflows(), ids=lambda p: p.name)
def test_every_workflow_is_valid_yaml_with_jobs(path):
    parsed = yaml.safe_load(path.read_text(encoding="utf-8"))

    assert parsed["jobs"]


@pytest.mark.parametrize("path", _all_workflows(), ids=lambda p: p.name)
def test_every_third_party_action_is_pinned_to_a_commit_sha(path):
    uses = re.findall(r"uses:\s*(\S+)", path.read_text(encoding="utf-8"))

    unpinned = [u for u in uses if not re.search(r"@[0-9a-f]{40}$", u)]
    assert unpinned == []


def test_manifest_job_uses_the_single_generator_not_an_inline_copy():
    manifest = yaml.dump(_jobs(RELEASE)["manifest"])

    assert "scripts/gen_distribution_manifest.py" in manifest
    assert "python3 -" not in manifest
    assert "<<'PY'" not in RELEASE


def test_manifest_job_publishes_pinned_installer_scripts_and_attests_the_manifest():
    manifest = yaml.dump(_jobs(RELEASE)["manifest"])

    for script in ("install.sh", "install.ps1", "install.cmd"):
        assert f"distribution/{script}" in manifest
    assert "attest-build-provenance" in manifest
    assert "distribution/latest.json" in manifest


def test_dispatch_from_a_branch_other_than_main_fails_with_a_clear_message():
    steps = _jobs(RELEASE)["release"]["steps"]
    guard = steps[0]

    assert "workflow_dispatch" in guard["if"]
    assert "refs/heads/main" in guard["if"]
    assert "main" in guard["run"] and "exit 1" in guard["run"]


def test_release_builds_wait_for_a_green_ci_gate():
    jobs = _jobs(RELEASE)

    assert "gate" in jobs
    for build in DOTNET_JOBS:
        assert "gate" in jobs[build]["needs"]


def test_an_incomplete_release_raises_an_alert():
    jobs = _jobs(RELEASE)

    alert = jobs["alert"]
    assert "failure()" in alert["if"]
    assert set(alert["needs"]) >= set(DOTNET_JOBS) | {"manifest"}


@pytest.mark.parametrize("lock", ["web/package-lock.json"])
def test_lock_file_versions_follow_the_release_version(lock):
    extra = CONFIG["packages"]["."]["extra-files"]

    paths = {(e["path"], e["jsonpath"]) for e in extra if "jsonpath" in e}
    assert (lock, "$.version") in paths
    assert (lock, "$.packages[''].version") in paths


def test_ci_lints_shell_workflows_and_powershell_and_runs_pester_on_windows():
    jobs = _jobs(CI)
    text = yaml.dump(jobs)

    assert "shellcheck" in text
    assert "actionlint" in text
    assert "PSScriptAnalyzer" in text
    assert "Invoke-Pester" in text
    windows = [j for j in jobs.values() if j.get("runs-on") == "windows-latest"]
    assert windows


@pytest.mark.parametrize("script", ["install.sh", "install.ps1"])
def test_installers_default_to_the_canonical_repo_slug(script):
    text = (ROOT / "distribution" / script).read_text(encoding="utf-8")

    assert "gutzerk/code_chroma" in text
    assert "UshakovDV/code-chroma" not in text


def test_cmd_bootstrap_forwards_arguments_and_restricts_protocol_by_default():
    text = (ROOT / "distribution" / "install.cmd").read_text(encoding="utf-8")

    assert "%*" in text
    assert "--proto =https --tlsv1.2" in text
    assert "test hook" in text.lower()


DOTNET_JOBS = ["dotnet-windows", "dotnet-macos", "dotnet-linux"]


@pytest.mark.parametrize("job", DOTNET_JOBS)
def test_dotnet_release_jobs_run_on_every_release_without_a_repository_variable(job):
    spec = _jobs(RELEASE)[job]

    assert "release_created" in spec["if"]
    assert "CODECROMA_BUILD_DOTNET" not in yaml.dump(spec)
    assert "gate" in spec["needs"]


@pytest.mark.parametrize("job", DOTNET_JOBS)
def test_dotnet_release_jobs_publish_drafts_and_pin_the_velopack_cli(job):
    text = yaml.dump(_jobs(RELEASE)[job])

    assert "draft: true" in text
    assert "dotnet tool install --global vpk --version 1.2.161" in text
    assert "distribution/velopack/pack." in text
    assert "dotnet publish dotnet/CodeChroma.Shell.App" in text
    assert "-p:BundleCSharpBridge=true" in text
    assert "pyinstaller" not in text


def test_the_release_workflow_has_no_electron_or_pyinstaller_step():
    text = RELEASE.lower()

    assert "electron" not in text
    assert "pyinstaller" not in text


def test_the_manifest_and_alert_wait_for_every_dotnet_job():
    manifest = _jobs(RELEASE)["manifest"]

    assert set(manifest["needs"]) >= set(DOTNET_JOBS)
    assert "!cancelled()" in manifest["if"] and "!failure()" in manifest["if"]
    assert set(_jobs(RELEASE)["alert"]["needs"]) >= set(DOTNET_JOBS)


def test_ci_runs_the_csharp_shell_tests_on_all_three_oses():
    job = _jobs(CI)["dotnet-shell"]

    assert set(job["strategy"]["matrix"]["os"]) == {"ubuntu-latest", "windows-latest", "macos-14"}
    assert "dotnet test dotnet/CodeChroma.Shell.sln" in yaml.dump(job)
