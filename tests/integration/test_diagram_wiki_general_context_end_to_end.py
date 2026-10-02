"""Integration: a real bridge over a fixture repo, proving the wiki-general-context route serves
the compact root+containers bundle -- smaller than a full structure dump, and a static snapshot that
doesn't drift when the underlying repo changes (049 -- wiki-general has no sync/fingerprint of its
own, unlike /wiki-context)."""

from fastapi.testclient import TestClient

from tests.integration.test_wiki_general_end_to_end import _write_wiki_general_tree

_UNDOCUMENTED_SOURCE = b"""
def helper(value):
    return value * 2
"""


def test_wiki_general_context_is_smaller_than_a_full_structure_dump(bridge):
    _write_wiki_general_tree(bridge.repo)

    with TestClient(bridge.app) as client:
        full_structure = client.get("/repos/default/structure?depth=5").content
        wiki_general_context = client.get("/repos/default/wiki-general-context").content

    assert len(wiki_general_context) < len(full_structure)


def test_editing_the_repo_after_generating_does_not_change_the_served_bundle(bridge):
    _write_wiki_general_tree(bridge.repo)
    new_file = bridge.repo / "billing" / "helpers.py"

    with TestClient(bridge.app) as client:
        ws = bridge.registry.get("default")
        before = client.get("/repos/default/wiki-general-context").json()
        new_file.write_bytes(_UNDOCUMENTED_SOURCE)
        ws.engine.reanalyze(["billing/helpers.py"])
        after = client.get("/repos/default/wiki-general-context").json()

    assert before == after
