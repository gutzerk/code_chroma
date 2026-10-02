"""The one response shape a successful/failed canvas batch commit returns -- shared by `PATCH
/repos/{id}/canvas` and every `POST /repos/{id}/recipes/{recipe}/run`."""

from __future__ import annotations

import uuid

from codechroma.bridge.workspaces import Workspace
from codechroma.canvas.apply_batch import BatchResult


def commit_canvas_batch(ws: Workspace, result: BatchResult) -> dict:
    """Saves and pings this repo's connected canvases on success; passes rejection errors on."""
    if not result.ok:
        return {"ok": False, "errors": [error.to_dict() for error in result.errors]}
    assert result.doc is not None  # guaranteed by ok=True, per BatchResult's own docstring
    failed = result.doc.save(ws.canvas_core_path, ws.diagrams_root)
    if failed:
        return {"ok": False, "errors": [
            {"op_index": -1, "code": "write_failed", "message": f"could not write {path} to disk"}
            for path in failed
        ]}
    batch_id = uuid.uuid4().hex
    ws.emit({
        "type": "canvas", "batch_id": batch_id,
        "affected": result.affected, "new_elements": list(result.id_map.values()),
    })
    return {"ok": True, "batch_id": batch_id, "id_map": result.id_map, "affected": result.affected}
