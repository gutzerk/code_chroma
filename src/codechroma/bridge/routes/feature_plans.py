"""Feature-plan diagram routes: the per-feature GET/-path pair for `feature-plan/<slug>`.

`feature-plan/<slug>` has a slash in its kind, same as `custom/<type_id>` -- so it needs its own
path pattern rather than the single-segment `{kind}` routes `routes/diagrams.py` auto-registers
from `DIAGRAMS.values()` at import time (a lazily-synthesized kind never enters that iteration,
`docs/architecture/graph-bridge-core.md`). Unlike `custom/<type_id>`, there is no saved library
definition to look up -- any filename-safe slug synthesizes a spec on demand
(`DiagramRegistry._synthesize_feature_plan`), so this file only ever needs the GET/-path pair, no
interview/list/save trio and no generate/status/output trio (feature-plan diagrams never
auto-generate, 055-diagram-feature-plan ticket 02).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from codechroma.bridge.deps import Ws
from codechroma.bridge.routes.diagrams import (
    delete_diagram_artifact,
    diagram_path_response,
    resolve_diagram,
)
from codechroma.diagrams import library

router = APIRouter()


def _require_valid_slug(slug: str) -> None:
    """A slug becomes a filename -- same "becomes a filename" discipline `custom/{type_id}` has."""
    if not library.valid_type_id(slug):
        raise HTTPException(status_code=400, detail=f"invalid feature-plan slug: {slug!r}")


# Registered before the bare `{slug}` GET, or `-path` requests would be captured by it and 404.
@router.get("/repos/{repo_id}/feature-plan/{slug}-path")
def get_feature_plan_path(slug: str, ws: Ws) -> dict:
    """Absolute location the bridge reads this feature's plan from, for the skill to write to."""
    _require_valid_slug(slug)
    return diagram_path_response(ws, f"feature-plan/{slug}", key_name="feature_plan_path")


@router.get("/repos/{repo_id}/feature-plan/{slug}")
def get_feature_plan(slug: str, ws: Ws) -> dict:
    """One feature's resolved Planned-block diagram -- via the registry's synthesized spec."""
    _require_valid_slug(slug)
    return resolve_diagram(ws, f"feature-plan/{slug}")


@router.delete("/repos/{repo_id}/feature-plan/{slug}")
def delete_feature_plan(slug: str, ws: Ws) -> dict:
    """Deletes this repo's own feature-plan diagram instance file."""
    _require_valid_slug(slug)
    return {"deleted": delete_diagram_artifact(ws, f"feature-plan/{slug}")}
