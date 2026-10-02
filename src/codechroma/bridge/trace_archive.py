"""Reading recorded execution traces off disk — `.codechroma/traces/<id>.json` and its sidecar.

Pure filesystem, no engine and no git, which is why it is its own thing rather than four more
methods on `Workspace`: the summary listing is the only place that has to care about the
`.meta.json` sidecar, and it can be tested against a bare directory.
"""

from __future__ import annotations

from pathlib import Path

from codechroma.io import load_json as _load_json


class TraceArchive:
    """Every trace the tracer CLI has written into one directory."""

    def __init__(self, traces_dir: Path) -> None:
        self.traces_dir = traces_dir

    def load(self, trace_id: str) -> dict:
        """Parses .codechroma/traces/<id>.json, tolerating a missing/malformed file (returns {})."""
        # `.name` strips any path the id smuggled in: an id is a file name, never a traversal.
        safe_id = Path(trace_id).name
        return _load_json(self.traces_dir / f"{safe_id}.json")

    def list_summaries(self) -> list[dict]:
        """Summaries of every recorded trace on disk, newest first."""
        try:
            paths = [p for p in self.traces_dir.glob("*.json") if not p.name.endswith(".meta.json")]
        except OSError:
            return []
        stamped = []
        for path in paths:
            try:
                stamped.append((path.stat().st_mtime, path))
            except OSError:
                continue
        stamped.sort(key=lambda item: item[0], reverse=True)
        summaries = []
        for _, path in stamped:
            summary = _summarize(path)
            if summary is not None:
                summaries.append(summary)
        return summaries


def _summarize(path: Path) -> dict | None:
    """Summary for one trace file, read from its .meta.json sidecar to avoid parsing every step."""
    meta = _load_json(path.with_name(f"{path.stem}.meta.json"))
    if isinstance(meta, dict) and "step_count" in meta:
        data = meta
        steps = None
    else:
        data = _load_json(path)
        if not isinstance(data, dict) or not data:
            return None
        steps = data.get("steps")
    return {
        "id": data.get("id", path.stem),
        "entry": data.get("entry", ""),
        "created_at": data.get("created_at", ""),
        "status": data.get("status", "ok"),
        "step_count": data.get("step_count", len(steps) if isinstance(steps, list) else 0),
    }
