"""Small per-option decision diagrams: budget check and the canvas batch that draws one."""

from __future__ import annotations

import math

from pydantic import BaseModel, ConfigDict, Field

from codechroma.questions.validation import QuestionRejected, rejection_text

LAYER = "decisions"
MAX_NODES = 12
_COLUMNS = 4
_CELL_W, _CELL_H = 200, 100
_NODE_W, _NODE_H = 160, 60
_BAND_H = 3 * _CELL_H + 80


class DiagramNode(BaseModel):
    """One box; `status: "new"` outlines a part that does not exist in the code yet."""

    id: str
    label: str
    description: str = ""
    status: str | None = None


class DiagramEdge(BaseModel):
    """One arrow between two node ids of the same diagram."""

    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    label: str = ""


def validate_diagram(nodes: list[DiagramNode], edges: list[DiagramEdge]) -> list[str]:
    """One line per budget or reference problem; empty when the graph may be drawn."""
    problems: list[str] = []
    if not 1 <= len(nodes) <= MAX_NODES:
        problems.append(f"give 1-{MAX_NODES} nodes, got {len(nodes)}")
    ids = [node.id for node in nodes]
    if len(set(ids)) != len(ids):
        problems.append("node ids are not unique")
    problems.extend(f'node "{n.id}": empty label' for n in nodes if not n.label.strip())
    problems.extend(
        f"edge {e.from_}->{e.to}: unknown node"
        for e in edges
        if e.from_ not in ids or e.to not in ids
    )
    return problems


def diagram_ops(
    title: str, nodes: list[DiagramNode], edges: list[DiagramEdge], band: int, option_id: str | None
) -> list[dict]:
    """The `apply_batch` ops for one diagram: a group root, its nodes in a grid, then the arrows."""
    top = band * _BAND_H
    ops: list[dict] = [{
        "op": "add_group", "temp_id": "root", "layer": LAYER, "label": title,
        "position": {"x": 0, "y": top},
        "size": {
            "w": _COLUMNS * _CELL_W + 40, "h": math.ceil(len(nodes) / _COLUMNS) * _CELL_H + 40,
        },
        "meta": {"diagram_root": True, "option_id": option_id},
    }]
    for index, node in enumerate(nodes):
        ops.append({
            "op": "add_element", "temp_id": f"n:{node.id}", "render": "custom", "layer": LAYER,
            "label": node.label, "description": node.description, "group_id": "root",
            "position": {
                "x": 20 + index % _COLUMNS * _CELL_W, "y": top + 20 + index // _COLUMNS * _CELL_H,
            },
            "size": {"w": _NODE_W, "h": _NODE_H},
            "meta": {"status": node.status} if node.status else {},
        })
    ops.extend(
        {
            "op": "add_edge", "from": f"n:{e.from_}", "to": f"n:{e.to}", "label": e.label,
            "layer": LAYER,
        }
        for e in edges
    )
    return ops


def check(nodes: list[DiagramNode], edges: list[DiagramEdge]) -> None:
    """Raises QuestionRejected with every problem, in the tool-error shape."""
    problems = validate_diagram(nodes, edges)
    if problems:
        raise QuestionRejected(rejection_text(problems, "diagram"))
