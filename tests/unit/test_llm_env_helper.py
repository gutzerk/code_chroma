"""The shell-launched env_helper prints the environment between two copies of a marker."""

import json
import subprocess
import sys

from codechroma.llm import env_helper


def test_print_environment_wraps_the_env_json_in_the_marker(capsys, monkeypatch):
    monkeypatch.setenv("CC_PROBE", "yes")

    env_helper.print_environment("@@")

    out = capsys.readouterr().out.strip()
    assert out.startswith("@@") and out.endswith("@@")
    assert json.loads(out[2:-2])["CC_PROBE"] == "yes"


def test_running_as_a_script_uses_argv_marker_without_importing_the_app(tmp_path):
    result = subprocess.run(
        [sys.executable, "-I", env_helper.__file__, "##"],
        capture_output=True, text=True, check=True, cwd=tmp_path, timeout=30,
    )

    out = result.stdout.strip()
    assert out.startswith("##") and out.endswith("##")
    assert isinstance(json.loads(out[2:-2]), dict)
