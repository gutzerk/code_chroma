"""POST /repos/{id}/recipes/{recipe}/run -- Stage 3 of 016-single-canvas-dashboard.

Converts a recipe's already-generated, already-resolved artifact into canvas ops and applies them
through the one write point (`apply_batch`), replacing only the elements/edges that recipe's own
layer still owns -- a hand-placed note or a user-renamed box is never touched (see
`canvas/recipes.py`). Generation itself (the Claude run that writes c1.json/patterns.json/
impact.json/custom/<id>.json) is unchanged and still lives under `routes/diagrams.py`/
`routes/custom_diagrams.py`; this route only re-projects what is already on disk onto the document.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from codechroma.bridge.deps import Ws
from codechroma.bridge.diagram_diagnostics import build_payload, merge_dropped
from codechroma.bridge.epics_resolver import epics_index
from codechroma.bridge.routes._canvas_write import commit_canvas_batch
from codechroma.bridge.routes.diagrams import resolve_diagram
from codechroma.bridge.workspaces import Workspace
from codechroma.canvas.apply_batch import apply_batch_chunked
from codechroma.canvas.document import CanvasDoc
from codechroma.canvas.locks import canvas_lock
from codechroma.canvas.recipes import recipe_for, run_recipe_with_drops

router = APIRouter()


def _resolved_for(ws: Workspace, name: str) -> dict:
    """`name`'s already-resolved payload; epics has no DIAGRAMS entry, everything else does."""
    if name == "epics":
        return epics_index(ws.root)
    return resolve_diagram(ws, name)


@router.post("/repos/{repo_id}/recipes/{recipe:path}/run")
def run_recipe_route(recipe: str, ws: Ws, confirm_mass_delete: bool = False) -> dict:
    """Reconciles `recipe`'s layer against its resolved payload -- no Claude call, PR-safe."""
    try:
        recipe_for(recipe)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"unknown recipe: {recipe!r}") from exc
    resolved = _resolved_for(ws, recipe)
    with canvas_lock(ws.id):
        doc = CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root)
        ops, converter_drops = run_recipe_with_drops(doc, recipe, resolved)
        result = apply_batch_chunked(
            doc, ops, layer=recipe, explanation=f"{recipe} recipe run",
            confirm_mass_delete=confirm_mass_delete,
        )
        response = commit_canvas_batch(ws, result)
    # Soft on purpose: this never joins `errors`, which would flip `ok` and block the render.
    diagnostics = merge_dropped(
        resolved.get("diagnostics"), build_payload(converter_drops)
    )
    if response.get("ok"):
        response["diagnostics"] = diagnostics
    return response
