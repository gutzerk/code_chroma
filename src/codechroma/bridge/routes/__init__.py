"""One APIRouter per feature area, each reading its collaborators from `bridge.deps`.

`create_app` includes them in this order; `graph` owns the `/repos/{id}/nodes/...` tree, and the
SPA catch-all is mounted after every router so `/repos/...` still wins over `/`.

🔴 `custom_diagrams`/`feature_plans` must come before `diagrams` in `ROUTERS`. Starlette matches
routes in registration order, and `diagrams.router` registers two truly generic routes --
`GET /repos/{repo_id}/{kind}/context` and `/review`, where `{kind}` matches any single segment. A
slug/type_id of exactly `"context"` or `"review"` has the same URL shape (`kind="custom"` or
`"feature-plan"`, literal third segment), so if `diagrams.router` were checked first it would win
and permanently shadow that one slug/type_id -- a real, silent bug the two `-path`/GET pairs would
otherwise never catch, since only this ordering makes the more-specific `custom/`/`feature-plan/`
routes win.
"""

from codechroma.bridge.routes import (
    agents,
    assistant,
    canvas,
    custom_diagrams,
    diagrams,
    diffs,
    epics,
    events,
    feature_plans,
    graph,
    llm_settings,
    prs,
    recipes,
    runtime,
    traces,
    wiki_general,
    workspaces,
)

# custom_diagrams/feature_plans must precede diagrams -- see the module docstring's 🔴 note.
ROUTERS = (
    graph.router,
    assistant.router,
    runtime.router,
    diffs.router,
    llm_settings.router,
    canvas.router,
    recipes.router,
    custom_diagrams.router,
    feature_plans.router,
    diagrams.router,
    epics.router,
    wiki_general.router,
    traces.router,
    workspaces.router,
    prs.router,
    agents.router,
    events.router,
)

__all__ = ["ROUTERS"]
