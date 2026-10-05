"""SC-001's automated backstop: the new shared resolve_diagram()/reshape() pipeline draws the same
nodes/relations the pre-036 per-type resolvers did, for a fixed input per type. Compares against
`tests/fixtures/diagram_parity/*.golden.json` (captured from the now-deleted `resolve_c1`/
`resolve_patterns`/`resolve_impact_diagram`/`resolve_custom` + `*_reshape` functions, T003) -- a
structural, node_id-anchored comparison, not byte-for-byte: the old `GraphNode`'s `key`/`aliases`/
`dedup_id`/`children` fields don't survive Decision 6's flattening, so identity is anchored on each
node's own resolved `node_id` (or its label, for a conceptual box with none) instead of its
implementation-internal key.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from codechroma.diagrams import library
from tests.conftest import diagram_json_path

GOLDEN_DIR = Path(__file__).parent.parent / "fixtures" / "diagram_parity"


def _golden(name: str) -> dict:
    return json.loads((GOLDEN_DIR / f"{name}.golden.json").read_text(encoding="utf-8"))


def _anchor(node: dict) -> str:
    """A stable identity across implementations: its real graph node, else its label."""
    node_id = node.get("node_id")
    return node_id if isinstance(node_id, str) and node_id else f"label::{node['label']}"


def _flatten_old_tree(nodes: list[dict]) -> list[dict]:
    """The pre-036 nested `GraphNode` tree (c1 only), flattened to one list, parent-first."""
    flat = []
    for node in nodes:
        flat.append(node)
        flat.extend(_flatten_old_tree(node.get("children") or []))
    return flat


_RelationSet = set[tuple[str, str, str]]


def _old_nodes_by_anchor(golden: dict, *, nested: bool = False) -> dict[str, dict]:
    raw = golden["graph_shape"]["nodes"]
    raw = _flatten_old_tree(raw) if nested else raw
    return {_anchor(node): node for node in raw}


def _old_relations(golden: dict, by_anchor: dict[str, dict]) -> _RelationSet:
    """Old relations keyed by anchor pairs -- the synthetic `key` differs, identity doesn't."""
    by_key = {node["key"]: anchor for anchor, node in by_anchor.items()}
    return {
        (by_key[rel["from"]], by_key[rel["to"]], rel.get("label") or "")
        for rel in golden["graph_shape"]["relations"]
    }


def _new_nodes_by_anchor(nodes: list[dict]) -> dict[str, dict]:
    return {_anchor({**node, "label": node["name"]}): node for node in nodes}


def _new_relations(relations: list[dict], new_by_anchor: dict[str, dict]) -> _RelationSet:
    """New relations keyed by anchor pairs -- `from`/`to` are the authored ids, not the anchor."""
    by_id = {node["id"]: anchor for anchor, node in new_by_anchor.items()}
    return {(by_id[rel["from"]], by_id[rel["to"]], rel.get("label") or "") for rel in relations}


def _assert_same_boxes(old_by_anchor: dict[str, dict], new_by_anchor: dict[str, dict]) -> None:
    assert set(new_by_anchor) == set(old_by_anchor)
    for anchor, old_node in old_by_anchor.items():
        new_node = new_by_anchor[anchor]
        assert new_node["name"] == old_node["label"], anchor
        assert (new_node.get("group") or None) == (old_node.get("group") or None), anchor


def test_c1_parity(bridge):
    golden = _golden("c1")
    c1_path = diagram_json_path(bridge.repo, "c1")
    c1_path.parent.mkdir(parents=True, exist_ok=True)
    c1_path.write_text(json.dumps(golden["input"]), encoding="utf-8")

    with TestClient(bridge.app) as client:
        body = client.get("/repos/default/c1").json()

    old_by_anchor = _old_nodes_by_anchor(golden, nested=True)
    new_by_anchor = _new_nodes_by_anchor(body["nodes"])
    _assert_same_boxes(old_by_anchor, new_by_anchor)
    assert _new_relations(body["relations"], new_by_anchor) == _old_relations(golden, old_by_anchor)


def test_patterns_parity(bridge):
    golden = _golden("patterns")
    patterns_path = diagram_json_path(bridge.repo, "patterns")
    patterns_path.parent.mkdir(parents=True, exist_ok=True)
    patterns_path.write_text(json.dumps(golden["input"]), encoding="utf-8")

    with TestClient(bridge.app) as client:
        body = client.get("/repos/default/patterns").json()

    old_by_anchor = _old_nodes_by_anchor(golden)
    new_by_anchor = _new_nodes_by_anchor(body["nodes"])
    _assert_same_boxes(old_by_anchor, new_by_anchor)
    assert _new_relations(body["relations"], new_by_anchor) == _old_relations(golden, old_by_anchor)


def _with_status_in_meta(nodes: list[dict]) -> list[dict]:
    """036's authored shape moves impact's `status` into `meta` (data-model.md's Node.meta)."""
    return [
        {k: v for k, v in node.items() if k != "status"} | {"meta": {"status": node.get("status")}}
        for node in nodes
    ]


def test_impact_parity(bridge):
    golden = _golden("impact")
    impact_input = {**golden["input"], "nodes": _with_status_in_meta(golden["input"]["nodes"])}
    impact_path = diagram_json_path(bridge.repo, "impact")
    impact_path.parent.mkdir(parents=True, exist_ok=True)
    impact_path.write_text(json.dumps(impact_input), encoding="utf-8")

    with TestClient(bridge.app) as client:
        body = client.get("/repos/default/impact").json()

    old_by_anchor = _old_nodes_by_anchor(golden)
    new_by_anchor = _new_nodes_by_anchor(body["nodes"])
    _assert_same_boxes(old_by_anchor, new_by_anchor)
    for anchor, old_node in old_by_anchor.items():
        assert new_by_anchor[anchor]["meta"]["status"] == old_node["meta"]["status"], anchor
    assert _new_relations(body["relations"], new_by_anchor) == _old_relations(golden, old_by_anchor)


def test_custom_parity(bridge, tmp_path, monkeypatch):
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))
    golden = _golden("custom")
    library.save_type({
        "id": "arch", "title": "Arch", "style": golden["definition"]["style"],
        "layout": {"direction": "LR"}, "grouping": golden["definition"]["grouping"],
        "relation_kinds": [{"id": "uses", "label": "uses"}],
        "instructions": "One box per component.",
    })
    custom_path = diagram_json_path(bridge.repo, "custom/arch")
    custom_path.parent.mkdir(parents=True, exist_ok=True)
    custom_path.write_text(json.dumps(golden["input"]), encoding="utf-8")

    with TestClient(bridge.app) as client:
        body = client.get("/repos/default/custom/arch").json()

    old_by_anchor = _old_nodes_by_anchor(golden)
    new_by_anchor = _new_nodes_by_anchor(body["nodes"])
    _assert_same_boxes(old_by_anchor, new_by_anchor)
    assert _new_relations(body["relations"], new_by_anchor) == _old_relations(golden, old_by_anchor)
    assert set(body["groups"]) == set(golden["resolved"]["groups"])
