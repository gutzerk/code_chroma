import json
import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
RELEASE = (WORKFLOWS / "release-please.yml").read_text(encoding="utf-8")
CI = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")
SMOKE_PATH = WORKFLOWS / "packaging-smoke.yml"
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
    for build in ("macos", "windows", "linux"):
        assert "gate" in jobs[build]["needs"]


def test_an_incomplete_release_raises_an_alert():
    jobs = _jobs(RELEASE)

    alert = jobs["alert"]
    assert "failure()" in alert["if"]
    assert set(alert["needs"]) >= {"macos", "windows", "linux", "manifest"}


@pytest.mark.parametrize("build", ["macos", "windows"])
def test_signing_hooks_are_forwarded_only_when_secrets_exist(build):
    steps = _jobs(RELEASE)[build]["steps"]
    hook = next(s for s in steps if "signing" in s.get("name", ""))

    prefix = "MAC" if build == "macos" else "WIN"
    assert any(k.startswith(f"{prefix}_CSC_LINK") for k in hook["env"])
    assert "GITHUB_ENV" in hook["run"]
    assert '-n "$' in hook["run"] or "-not [string]::IsNullOrEmpty" in hook["run"]


@pytest.mark.parametrize("lock", ["desktop/package-lock.json", "web/package-lock.json"])
def test_lock_file_versions_follow_the_release_version(lock):
    extra = CONFIG["packages"]["."]["extra-files"]

    paths = {(e["path"], e["jsonpath"]) for e in extra}
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


def test_packaging_smoke_runs_on_pull_requests_without_publishing():
    smoke = yaml.safe_load(SMOKE_PATH.read_text(encoding="utf-8"))
    text = SMOKE_PATH.read_text(encoding="utf-8")

    assert "pull_request" in smoke[True]
    assert "pyinstaller" in text.lower()
    assert "--dir" in text
    assert "action-gh-release" not in text and "attest-build" not in text


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


LEGACY = ["install_desktop.sh", "install_linux.sh", "install_desktop.ps1"]


@pytest.mark.parametrize("script", LEGACY)
def test_legacy_scripts_are_thin_forwarders_to_the_distribution_installer(script):
    text = (ROOT / "scripts" / script).read_text(encoding="utf-8")

    assert "distribution/install." in text
    assert "gutzerk/code_chroma" in text
    assert "UshakovDV/code-chroma" not in text
    assert len(text.splitlines()) < 40


DOTNET_JOBS = ["dotnet-windows", "dotnet-macos", "dotnet-linux"]
ELECTRON_JOBS = ["macos", "windows", "linux"]


@pytest.mark.parametrize("job", DOTNET_JOBS)
def test_dotnet_release_jobs_are_off_unless_the_repo_variable_enables_them(job):
    spec = _jobs(RELEASE)[job]

    assert "vars.CODECROMA_BUILD_DOTNET == 'true'" in spec["if"]
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


@pytest.mark.parametrize("job", ELECTRON_JOBS)
def test_the_electron_jobs_are_still_there_and_unconditional_on_the_dotnet_variable(job):
    text = yaml.dump(_jobs(RELEASE)[job])

    assert "CODECROMA_BUILD_DOTNET" not in text
    assert "electron" in text.lower()


def test_a_skipped_dotnet_job_does_not_skip_the_manifest_but_a_failed_one_does():
    manifest = _jobs(RELEASE)["manifest"]

    assert set(manifest["needs"]) >= set(DOTNET_JOBS) | set(ELECTRON_JOBS)
    assert "!cancelled()" in manifest["if"] and "!failure()" in manifest["if"]
    assert set(_jobs(RELEASE)["alert"]["needs"]) >= set(DOTNET_JOBS)


def test_ci_runs_the_csharp_shell_tests_on_all_three_oses():
    job = _jobs(CI)["dotnet-shell"]

    assert set(job["strategy"]["matrix"]["os"]) == {"ubuntu-latest", "windows-latest", "macos-14"}
    assert "dotnet test dotnet/CodeChroma.Shell.sln" in yaml.dump(job)
