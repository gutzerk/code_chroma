"""Unit coverage for FrameMapper: resolving runtime frames to CodeChroma function node ids."""

import shutil
from pathlib import Path

import pytest

from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer
from codechroma.trace.mapper import FrameMapper

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


@pytest.fixture
def mapper(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    return FrameMapper(engine, repo), repo


@pytest.mark.parametrize(
    "rel_file,qualname,lineno,expected",
    [
        (
            "users/service.py", "UserService.create_user", 11,
            "users/service.py::function::UserService.create_user",
        ),
        ("shared/text_utils.py", "slugify", 4, "shared/text_utils.py::function::slugify"),
        (
            "users/service.py", "UserService.<locals>.mystery", 13,
            "users/service.py::function::UserService.create_user",
        ),
        # external frames resolve to none regardless of qualname/line
        (None, "loads", 1, None),
        ("users/service.py", "nope", 1, None),
    ],
)
def test_resolve(mapper, rel_file, qualname, lineno, expected):
    frame_mapper, repo = mapper
    filename = (
        str(repo / rel_file) if rel_file is not None else "/usr/lib/python3.14/json/decoder.py"
    )

    node_id = frame_mapper.resolve(filename, qualname, lineno)

    assert node_id == expected
