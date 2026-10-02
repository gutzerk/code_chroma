"""The process-wide bridge app, for `uvicorn codechroma.bridge.server:app` and the frozen desktop.

Everything that used to live here as module globals and 1058 lines of routes now lives in
`bridge/app.py` (the factory), `bridge/services.py` (the collaborators) and `bridge/routes/*`
(one APIRouter per feature area). This module exists so the two entry points that name it --
`launch.py`'s uvicorn command line and `packaging/bridge_main.py` -- keep working unchanged.

Importing this module still builds and analyzes a repository, because `app` has to exist at module
scope for uvicorn. Anything that does not need that (every test) should import `create_app` from
`bridge.app` instead.
"""

from __future__ import annotations

import atexit

from codechroma.bridge.app import create_app

app = create_app()

# Net for a hard exit that skips the lifespan; loop-free, so it is safe at interpreter exit.
atexit.register(app.state.services.agent_sessions.terminate_all)
