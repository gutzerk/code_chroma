import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SHELL = shutil.which("pwsh") or shutil.which("powershell")
PROBE = "if (Get-Module -ListAvailable Pester | Where-Object { $_.Version.Major -ge 5 }) { 'yes' }"


def _has_pester5() -> bool:
    if SHELL is None:
        return False
    probe = subprocess.run(
        [SHELL, "-NoProfile", "-Command", PROBE], capture_output=True, text=True, check=False
    )
    return "yes" in probe.stdout


@pytest.mark.skipif(not _has_pester5(), reason="needs PowerShell with Pester 5+")
def test_install_ps1_pester_suite_passes():
    command = (
        "Import-Module Pester -MinimumVersion 5.0.0; "
        "$r = Invoke-Pester -Path tests/pester -PassThru -Output None; exit $r.FailedCount"
    )

    result = subprocess.run(
        [SHELL, "-NoProfile", "-Command", command],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout[-3000:]
