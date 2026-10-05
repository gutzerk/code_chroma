"""plan-04: a custom Settings(...) takes effect because reads happen at call time, not import.

Each test swaps the module's `settings` global for a custom one and asserts the running code honors
the new value. Before plan-04 these all failed because the value was copied into a module constant
(or a default argument) at import time.
"""

import subprocess

from codechroma.bridge import git_cmd
from codechroma.config import AISummarizerConfig, GitConfig, Settings
from codechroma.summarize.ai_summarizer import AISummarizer


def test_ai_summarizer_reads_model_at_construction(monkeypatch):
    custom = Settings(ai_summarizer=AISummarizerConfig(model="custom-model"))
    monkeypatch.setattr("codechroma.summarize.ai_summarizer.settings", custom)

    summarizer = AISummarizer()

    assert summarizer._model == "custom-model"


def test_ai_summarizer_explicit_model_wins_over_settings(monkeypatch):
    custom = Settings(ai_summarizer=AISummarizerConfig(model="custom-model"))
    monkeypatch.setattr("codechroma.summarize.ai_summarizer.settings", custom)

    summarizer = AISummarizer(model="hand-picked")

    assert summarizer._model == "hand-picked"


def test_git_cmd_timeout_is_read_at_call_time(monkeypatch, tmp_path):
    custom = Settings(git=GitConfig(short_timeout_seconds=3))
    monkeypatch.setattr("codechroma.bridge.git_cmd.settings", custom)
    captured: dict = {}
    real_run = subprocess.run

    def capture(*args, **kwargs):
        captured["timeout"] = kwargs.get("timeout")
        return real_run(*args, **kwargs)

    monkeypatch.setattr(git_cmd.subprocess, "run", capture)

    # A git command that returns immediately; only the timeout read is under test.
    result = git_cmd.run_git_raw(tmp_path, "rev-parse", "--is-inside-work-tree")

    assert result is not None
    assert captured["timeout"] == 3
