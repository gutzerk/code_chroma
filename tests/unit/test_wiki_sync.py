"""Unit tests for wiki/sync.py's fallback path: no prior state must never crash sync_wiki()."""

from codechroma.wiki.hashtree import load_previous_tree


def test_load_previous_tree_is_none_for_a_missing_hashtree_file(tmp_path):
    assert load_previous_tree(tmp_path / "wiki") is None


def test_load_previous_tree_is_none_for_a_corrupt_hashtree_file(tmp_path):
    output_dir = tmp_path / "wiki"
    output_dir.mkdir(parents=True)
    (output_dir / ".hashtree.json").write_text("not valid json{{{", encoding="utf-8")

    assert load_previous_tree(output_dir) is None
