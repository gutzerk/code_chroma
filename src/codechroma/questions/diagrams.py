"""Small per-option decision diagrams: budget check and the canvas batch that draws one."""

from __future__ import annotations

import math

from pydantic import BaseModel, ConfigDict, Field

from codechroma.questions.validation import QuestionRejected, rejection_text

LAYER = "decisions"
MAX_NODES = 12
MAX_ID = 40
MAX_TITLE = 80
MAX_LABEL = 60
MAX_DESCRIPTION = 300
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


def validate_diagram(
    nodes: list[DiagramNode], edges: list[DiagramEdge], title: str | None = None
) -> list[str]:
    """One line per budget, length or reference problem; mirrors the skill's check script."""
    found: list[str] = []
    if title is not None:
        if not title.strip():
            found.append("title is empty")
        elif len(title) > MAX_TITLE:
            found.append(f"title is longer than {MAX_TITLE} characters")
    if not 1 <= len(nodes) <= MAX_NODES:
        found.append(f"give 1-{MAX_NODES} nodes, got {len(nodes)}")
    ids = [node.id for node in nodes]
    if len(set(ids)) != len(ids):
        found.append("node ids are not unique")
    for n in nodes:
        if not n.id.strip():
            found.append("node with empty id")
        elif len(n.id) > MAX_ID:
            found.append(f'node "{n.id}": id is longer than {MAX_ID} characters')
        if not n.label.strip():
            found.append(f'node "{n.id}": empty label')
        elif len(n.label) > MAX_LABEL:
            found.append(f'node "{n.id}": label is longer than {MAX_LABEL} characters')
        if len(n.description) > MAX_DESCRIPTION:
            found.append(
                f'node "{n.id}": description is longer than {MAX_DESCRIPTION} characters'
            )
    seen: set[tuple[str, str]] = set()
    for e in edges:
        if e.from_ not in ids or e.to not in ids:
            found.append(f"edge {e.from_}->{e.to}: unknown node")
        elif e.from_ == e.to:
            found.append(f"edge {e.from_}->{e.to}: self-loop")
        elif (e.from_, e.to) in seen:
            found.append(f"edge {e.from_}->{e.to}: duplicate")
        seen.add((e.from_, e.to))
    return found


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


def check(
    nodes: list[DiagramNode], edges: list[DiagramEdge], title: str | None = None
) -> None:
    """Raises QuestionRejected with every problem, in the tool-error shape."""
    problems = validate_diagram(nodes, edges, title)
    if problems:
        raise QuestionRejected(rejection_text(problems, "diagram"))
