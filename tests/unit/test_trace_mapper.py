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


def test_method_qualname_resolves_to_function_node(mapper):
    frame_mapper, repo = mapper
    filename = str(repo / "users" / "service.py")

    node_id = frame_mapper.resolve(filename, "UserService.create_user", 11)

    assert node_id == "users/service.py::function::UserService.create_user"


def test_module_level_function_resolves(mapper):
    frame_mapper, repo = mapper
    filename = str(repo / "shared" / "text_utils.py")

    node_id = frame_mapper.resolve(filename, "slugify", 4)

    assert node_id == "shared/text_utils.py::function::slugify"


def test_line_fallback_when_qualname_mismatches(mapper):
    frame_mapper, repo = mapper
    filename = str(repo / "users" / "service.py")

    node_id = frame_mapper.resolve(filename, "UserService.<locals>.mystery", 13)

    assert node_id == "users/service.py::function::UserService.create_user"


def test_external_frame_resolves_to_none(mapper):
    frame_mapper, _ = mapper

    node_id = frame_mapper.resolve("/usr/lib/python3.14/json/decoder.py", "loads", 1)

    assert node_id is None


def test_unknown_qualname_and_line_outside_any_function_is_none(mapper):
    frame_mapper, repo = mapper
    filename = str(repo / "users" / "service.py")

    node_id = frame_mapper.resolve(filename, "nope", 1)

    assert node_id is None
