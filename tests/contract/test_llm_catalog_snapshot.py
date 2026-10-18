"""The LLM catalog the C# bridge embeds must match the Python call-site and adapter definitions."""

import json

from tests.contract.llm_catalog import CATALOG_PATH, build_catalog


def test_embedded_llm_catalog_matches_the_python_definitions():
    embedded = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))

    assert embedded == build_catalog(), "run: python -m tests.contract.llm_catalog"
