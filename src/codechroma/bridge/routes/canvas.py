"""GET/PATCH /repos/{id}/canvas -- the one document, the one write point (016-single-canvas).

Stage 3 adds the recipes' own write point (`routes/recipes.py`), sharing this module's commit
response shape via `_canvas_write.commit_canvas_batch`. The chat skill (Stage 5) will write through
the same `apply_batch` seam once it lands.
"""

from __future__ import annotations

from fastapi import APIRouter

from codechroma.bridge.deps import Ws
from codechroma.bridge.routes._canvas_write import commit_canvas_batch
from codechroma.canvas.apply_batch import apply_batch
from codechroma.canvas.document import CanvasDoc
from codechroma.canvas.locks import canvas_lock

router = APIRouter()


@router.get("/repos/{repo_id}/canvas")
def get_canvas(ws: Ws) -> dict:
    """This workspace's document verbatim -- ensure_seeded guaranteed it has a root block."""
    return CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root).model_dump(by_alias=True)


@router.patch("/repos/{repo_id}/canvas")
def patch_canvas(ws: Ws, batch: dict) -> dict:
    """Applies one batch of ops; layout/content only, so a read-only PR checkout can edit it too."""
    with canvas_lock(ws.id):
        doc = CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root)
        result = apply_batch(
            doc,
            batch.get("ops") or [],
            layer=batch.get("layer", "default"),
            explanation=batch.get("explanation", ""),
            confirm_mass_delete=bool(batch.get("confirm_mass_delete", False)),
        )
        return commit_canvas_batch(ws, result)
