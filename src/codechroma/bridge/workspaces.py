"""One analyzed repository root per Workspace, so `repo_id` in /repos/{repo_id}/... selects one.

The bridge used to be "one process = one repository": `engine`, `git_sync` and every `.codechroma/*`
path were module globals bound to a single root. A `Workspace` is that same bundle, per root — its
own `GraphEngine`, `GitSync`, artifact paths and watchers — and `WorkspaceRegistry` maps
an id onto one. `"main"` is `create_app`'s repo root and comes up as the app is built; an agent
worktree is registered later and brought up lazily on first access, never at creation time.

A `Workspace` delegates to three cohesive helpers, so a conceptual change stops touching every
concern in one class: `WorkspaceArtifacts` (pure path/IO derivation), `WorkspaceWatchers`
(registry-driven file/dir watching), and `WorkspaceGit` (a thin shim over `GitSync` + `git_cmd`).
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from codechroma.bridge import epics_resolver
from codechroma.bridge.agents import worktree
from codechroma.bridge.bootstrap_diagrams import bootstrap_all_if_missing
from codechroma.bridge.bootstrap_wiki import bootstrap_wiki_if_missing
from codechroma.bridge.diagram_migration import migrate
from codechroma.bridge.diagram_registry import DIAGRAMS
from codechroma.bridge.git_cmd import porcelain_paths, run_git
from codechroma.bridge.git_sync import GitSync
from codechroma.bridge.layout_store import LayoutStore, layout_path_for
from codechroma.bridge.live import DirWatcher, FileWatcher, RepoWatcher, _Watcher
from codechroma.bridge.overlays import impact_changes_path
from codechroma.bridge.trace_archive import TraceArchive
from codechroma.config import settings
from codechroma.dependencies.digest import dependency_digest_path, load_dependency_digest
from codechroma.engine import GraphEngine
from codechroma.io import load_json, write_json
from codechroma.summarize.ai_summarizer import AISummarizer

logger = logging.getLogger("uvicorn.error")

MAIN_ID = "main"

# A fetched pull request's workspace id; agents.manager refuses an agent id that would shadow one.
PR_ID_PREFIX = "pr-"

STATE_ANALYZING = "analyzing"
STATE_READY = "ready"
STATE_ERROR = "error"

OnEvent = Callable[[dict], None]


def _idle_unload_seconds() -> int:
    # Unloaded after this long untouched; graph.db stays, so returning is another analyze.
    return settings.workspaces.idle_unload_seconds

# The registry's sink also takes the workspace id as a broadcast key (ConnectionManager shape).
OnKeyedEvent = Callable[[dict, str | None], None]


class WorkspaceArtifacts:
    """The `.codechroma/*` paths, reads and layout stores of one workspace -- pure path/IO."""

    def __init__(self, ws: Workspace) -> None:
        self._ws = ws

    @property
    def dependency_digest_path(self) -> Path:
        """Where GraphEngine persists the dependency digest -- always fresh after sync()."""
        return dependency_digest_path(self.root)

    def load_dependency_digest(self) -> dict:
        return load_dependency_digest(self.root)

    @property
    def c1_root(self) -> Path:
        """Whose C1 diagram this workspace draws — a pull request borrows the main checkout's."""
        # A PR changes the code, not the architecture; a per-PR diagram is a Claude call wasted.
        return self._ws.c1_source_root or self.root

    def diagram_artifact_path(self, kind: str) -> Path:
        """Where a diagram kind's authored JSON lives -- built-in or synthesized custom type."""
        spec = DIAGRAMS.get(kind)
        if spec is not None:
            return spec.artifact_path(spec.root_for(self._ws))
        # Unknown kind: fall back to a custom-dir artifact so a future kind stays addressable.
        return DIAGRAMS.custom_dir(self.root) / f"{kind}.json"

    def diagram_path(self, kind: str) -> Path:
        """Where a diagram type's authored JSON lives -- the file its SkillAgent snapshots."""
        return self.diagram_artifact_path(kind)

    def layout_store(self, kind: str) -> LayoutStore:
        """One saved-layout store per kind -- only the root differs, never the filename shape."""
        spec = DIAGRAMS.get(kind)
        # Non-DIAGRAMS views (hierarchy, epics) have no borrowed root; they always use this one.
        return LayoutStore(layout_path_for(spec.root_for(self._ws) if spec else self.root, kind))

    def diagram_projection_path(self, kind: str) -> Path:
        """Where a kind's canvas content lives -- own diagrams_root always, never borrowed root."""
        return self.diagrams_root / kind / "projection.json"

    @property
    def impact_changes_path(self) -> Path:
        """The agent's review of the current git diff, explained per Impact box; ephemeral."""
        # Not a DIAGRAMS kind: a review is written per workspace, never borrowed from main.
        return impact_changes_path(self.root)

    @property
    def traces_dir(self) -> Path:
        """Recorded execution traces the canvas replays; the tracer CLI writes <id>.json here."""
        return self.root / ".codechroma" / "traces"

    @property
    def canvas_core_path(self) -> Path:
        """Geometry for every element, plus content owned by no diagram; see canvas/document.py."""
        return self.root / ".codechroma" / "canvas-core.json"

    @property
    def diagrams_root(self) -> Path:
        """The directory every diagram's own `<kind>/projection.json` lives under."""
        return self.root / ".codechroma" / "diagrams"

    @property
    def wiki_index_path(self) -> Path:
        """The wiki's root page; its presence is what "has a wiki" means."""
        return self.root / ".codechroma" / "wiki" / "index.md"

    @property
    def wiki_general_index_path(self) -> Path:
        """The AI-generated semantic map's C1 root page -- a sibling path, never merged in."""
        return self.root / ".codechroma" / "wiki-general" / "index.md"

    def load_diagram(self, kind: str) -> dict:
        """Parses a diagram's JSON, converting a pre-036 legacy shape in place on first access."""
        path = self.diagram_path(kind)
        data = load_json(path)
        migrated, status = migrate(kind, data)
        if status == "converted":
            logger.info(
                "workspace %s: converted legacy %s diagram to the shared shape", self._ws.id, kind
            )
            write_json(path, migrated)
            return migrated
        if status == "needs_regeneration":
            logger.warning(
                "workspace %s: %s.json is a pre-036 file this bridge can't convert -- "
                "left on disk untouched, please regenerate",
                self._ws.id, kind,
            )
            return {**data, "needs_regeneration": True}
        return migrated

    def load_impact_changes(self) -> dict:
        """Parses .codechroma/impact-changes.json, tolerating a missing/malformed file ({})."""
        return load_json(self.impact_changes_path)

    def load_trace(self, trace_id: str) -> dict:
        """One recorded trace by id; {} when it is missing or unreadable."""
        return TraceArchive(self.traces_dir).load(trace_id)

    def list_traces(self) -> list[dict]:
        """Summaries of every recorded trace on disk, newest first."""
        return TraceArchive(self.traces_dir).list_summaries()

    @property
    def root(self) -> Path:
        return self._ws.root


class WorkspaceWatchers:
    """The file/dir watchers of one workspace -- registry-driven, so a new kind needs no edit."""

    def __init__(self, ws: Workspace) -> None:
        self._ws = ws
        self.watchers: list[_Watcher] = []

    def _diagram_change_callback(self, kind: str) -> Callable[[], None]:
        """A closure over `kind`, not a lambda default -- mypy can't infer a lambda's own type."""
        return lambda: self.on_diagram_change(kind)

    def build(self) -> None:
        root = self._ws.root
        self.repo_watcher = RepoWatcher(root, self.on_repo_change)
        self.trace_watcher = DirWatcher(self._ws.artifacts.traces_dir, self.on_trace_change)
        # One dir watcher for every custom type -- the registry owns the dir, so no per-type edits.
        self.custom_watcher = DirWatcher(DIAGRAMS.custom_dir(root), self.on_custom_change)
        # Same idea, one level over: every feature's own Feature-plan artifact, one dir watcher.
        self.feature_plan_watcher = DirWatcher(
            DIAGRAMS.feature_plan_dir(root), self.on_feature_plan_change
        )
        # A dict, not setattr(f"{kind}_watcher"): a dynamic attribute is ungreppable and untyped.
        self.diagram_watchers: dict[str, FileWatcher] = {
            kind: FileWatcher(
                self._ws.artifacts.diagram_path(kind), self._diagram_change_callback(kind)
            )
            for kind in DIAGRAMS
        }
        self.impact_changes_watcher = FileWatcher(
            self._ws.artifacts.impact_changes_path, self.on_impact_changes_change
        )
        self.wiki_general_watcher = FileWatcher(
            self._ws.artifacts.wiki_general_index_path, self.on_wiki_general_change
        )
        # Catches a write that skipped PATCH /canvas, e.g. a future recipe writing straight to disk.
        self.canvas_core_watcher = FileWatcher(
            self._ws.artifacts.canvas_core_path, self.on_canvas_change
        )
        # Same backstop, one sibling FileWatcher per built-in kind's own projection.json.
        self.diagram_projection_watchers: dict[str, FileWatcher] = {
            kind: FileWatcher(
                self._ws.artifacts.diagram_projection_path(kind), self.on_canvas_change
            )
            for kind in DIAGRAMS
        }
        # Only for a source outside this root; RepoWatcher already covers the in-repo case (D-08).
        self.epics_watchers = [
            DirWatcher(path, self.on_repo_change)
            for path in epics_resolver.external_watch_paths(root)
        ]
        self.watchers = [
            self.repo_watcher,
            self.trace_watcher,
            self.custom_watcher,
            self.feature_plan_watcher,
            *self.diagram_watchers.values(),
            *self.diagram_projection_watchers.values(),
            self.impact_changes_watcher,
            self.canvas_core_watcher,
            self.wiki_general_watcher,
            *self.epics_watchers,
        ]

    def start(self) -> None:
        for watcher in self.watchers:
            watcher.start()

    def stop(self) -> None:
        """Idempotent, and safe when start() was never called."""
        for watcher in self.watchers:
            watcher.stop()

    # --- watcher callbacks ---

    def on_repo_change(self) -> None:
        """Watcher callback: reanalyze what git reports changed, then ping canvases to re-fetch."""
        changed = self._ws.sync()
        if changed is not None:
            self._ws.emit({"type": "changed", "paths": changed})
        # A commit (or any HEAD move) may have made wiki-general stale -- let the canvas re-check.
        if self._ws.head_changed():
            self._ws.emit({"type": "wiki-general"})

    def on_diagram_change(self, kind: str) -> None:
        """Diagram-file watcher callback: ping canvases so that diagram's view re-fetches."""
        self._ws.emit({"type": kind})

    def on_impact_changes_change(self) -> None:
        """Review-file watcher callback: ping canvases so the change overlay re-fetches."""
        self._ws.emit({"type": "impact-changes"})

    def on_wiki_general_change(self) -> None:
        """Wiki-general root-page watcher callback: ping canvases so the notice re-checks status."""
        self._ws.emit({"type": "wiki-general"})

    def on_trace_change(self) -> None:
        """Traces-dir watcher callback: ping canvases so the trace list re-fetches."""
        self._ws.emit({"type": "trace"})

    def on_custom_change(self) -> None:
        """Custom-diagrams-dir watcher callback: also covers a custom kind's own projection.json."""
        self._ws.emit({"type": "custom"})
        self._ws.emit({"type": "canvas"})

    def on_feature_plan_change(self) -> None:
        """Feature-plans-dir watcher callback: also covers a feature-plan's own projection.json."""
        self._ws.emit({"type": "feature-plan"})
        self._ws.emit({"type": "canvas"})

    def on_canvas_change(self) -> None:
        """Canvas-file watcher callback: a bare `canvas` ping, same shape as `trace`/`custom`."""
        self._ws.emit({"type": "canvas"})


class WorkspaceGit:
    """The git-facing operations of one workspace: sync and divergence — no engine building."""

    def __init__(self, ws: Workspace) -> None:
        self._ws = ws

    def sync(self) -> list[str] | None:
        """Reanalyzes whatever git reports changed since the last call; returns those paths."""
        return self._ws.git_sync.sync(self._ws.engine)

    def head_changed(self) -> bool:
        """True once per HEAD move since the last call -- see GitSync.head_changed()."""
        return self._ws.git_sync.head_changed()

    def divergent_files(self) -> list[str]:
        """Files this worktree differs from the main branch on, committed and uncommitted alike."""
        # Three-dot semantics: two-dot would drag other people's commits on main in as well.
        return self._diff_against(self.diff_base())

    def changed_since(self, base_commit: str | None) -> list[str]:
        """Files different from base_commit's tree right now; falls back to divergent_files()."""
        if base_commit is None:
            return self.divergent_files()
        return self._diff_against(base_commit)

    def _diff_against(self, base: str) -> list[str]:
        paths: list[str] = []
        committed = run_git(self._ws.root, "diff", "--name-only", base, "--", ".")
        for line in (committed or "").splitlines():
            if line.strip():
                paths.append(line.strip())
        untracked = run_git(self._ws.root, "status", "--porcelain",
                            "--untracked-files=all", "--", ".")
        paths.extend(porcelain_paths(untracked or ""))
        return sorted(set(paths))

    def diff_base(self) -> str:
        """What the diff and review layers compare against — computed fresh, never stored."""
        # A stored hash stops being the divergence point the moment the agent pulls main in.
        if self._ws.id == MAIN_ID:
            return "HEAD"
        ref = self._ws.base_ref or worktree.main_branch(self._ws.root)
        merge_base = run_git(self._ws.root, "merge-base", ref, "HEAD")
        return merge_base.strip() if merge_base and merge_base.strip() else "HEAD"


@dataclass
class Workspace:
    """One analyzed root: its identity, engine, state, emit — delegating the rest to helpers."""

    id: str
    root: Path
    engine: GraphEngine
    git_sync: GitSync
    on_event: OnEvent
    state: str = STATE_ANALYZING
    progress: str = ""
    error: str | None = None
    # What the diff and review layers compare against; None means "this workspace's main branch".
    base_ref: str | None = None
    # A view, not a working copy: nothing here may be committed to, and no Claude run may start.
    read_only: bool = False
    # Whose c1.json/c1-layout.json to read; None means this workspace's own.
    c1_source_root: Path | None = None
    # Built lazily by create(); the watcher set itself lives in WorkspaceWatchers.
    _watchers: WorkspaceWatchers = field(default=None, repr=False, compare=False)  # type: ignore[assignment]
    _artifacts: WorkspaceArtifacts = field(default=None, repr=False, compare=False)  # type: ignore[assignment]
    _git: WorkspaceGit = field(default=None, repr=False, compare=False)  # type: ignore[assignment]

    @classmethod
    def create(
        cls,
        workspace_id: str,
        root: Path,
        on_event: OnEvent,
        *,
        base_ref: str | None = None,
        read_only: bool = False,
        c1_source_root: Path | None = None,
    ) -> Workspace:
        """Builds a workspace over `root`; the offline summarizer means it never calls Claude."""
        engine = GraphEngine(summarizer=AISummarizer())
        workspace = cls(id=workspace_id, root=root, engine=engine, git_sync=GitSync(root),
                        on_event=on_event, base_ref=base_ref, read_only=read_only,
                        c1_source_root=c1_source_root)
        workspace._artifacts = WorkspaceArtifacts(workspace)
        workspace._git = WorkspaceGit(workspace)
        workspace._watchers = WorkspaceWatchers(workspace)
        workspace._watchers.build()
        return workspace

    # --- delegated helpers (public names tests and routes depend on stay on `Workspace`) ---

    @property
    def artifacts(self) -> WorkspaceArtifacts:
        return self._artifacts

    @property
    def watchers(self) -> list[_Watcher]:
        return self._watchers.watchers

    @property
    def dependency_digest_path(self) -> Path:
        return self._artifacts.dependency_digest_path

    def load_dependency_digest(self) -> dict:
        return self._artifacts.load_dependency_digest()

    @property
    def c1_root(self) -> Path:
        return self._artifacts.c1_root

    def diagram_artifact_path(self, kind: str) -> Path:
        return self._artifacts.diagram_artifact_path(kind)

    def diagram_path(self, kind: str) -> Path:
        return self._artifacts.diagram_path(kind)

    def layout_store(self, kind: str) -> LayoutStore:
        return self._artifacts.layout_store(kind)

    @property
    def impact_changes_path(self) -> Path:
        return self._artifacts.impact_changes_path

    @property
    def traces_dir(self) -> Path:
        return self._artifacts.traces_dir

    @property
    def canvas_core_path(self) -> Path:
        return self._artifacts.canvas_core_path

    @property
    def diagrams_root(self) -> Path:
        return self._artifacts.diagrams_root

    def diagram_projection_path(self, kind: str) -> Path:
        return self._artifacts.diagram_projection_path(kind)

    @property
    def wiki_index_path(self) -> Path:
        return self._artifacts.wiki_index_path

    @property
    def wiki_general_index_path(self) -> Path:
        return self._artifacts.wiki_general_index_path

    def load_diagram(self, kind: str) -> dict:
        return self._artifacts.load_diagram(kind)

    def load_impact_changes(self) -> dict:
        return self._artifacts.load_impact_changes()

    def load_trace(self, trace_id: str) -> dict:
        return self._artifacts.load_trace(trace_id)

    def list_traces(self) -> list[dict]:
        return self._artifacts.list_traces()

    def start_watchers(self) -> None:
        self._watchers.start()

    def stop_watchers(self) -> None:
        self._watchers.stop()

    # --- lifecycle ---

    def analyze(self, seed_from: GraphEngine | None = None) -> None:
        """Brings the graph up, from a shared parse when there is one and from scratch otherwise."""
        try:
            if not self._fast_analyze(seed_from):
                self.progress = "analyzing the whole repository"
                self.engine.analyze(str(self.root))
            # Offline; safe only since analyze() single-flights per workspace, before watchers.
            bootstrap_wiki_if_missing(self)
            # 🔴 The one path from a workspace to Anthropic, in its own module so it is auditable.
            bootstrap_all_if_missing(self)
        except Exception as exc:
            self.state, self.error = STATE_ERROR, str(exc)
            logger.exception("workspace %s: analysis failed", self.id)
            raise
        self.state, self.progress, self.error = STATE_READY, "", None

    def _fast_analyze(self, seed_from: GraphEngine | None) -> bool:
        """Reuses the main checkout's parse, reanalyzing only what this worktree diverged on."""
        if seed_from is None:
            return False
        snapshot = seed_from.snapshot()
        if not snapshot.nodes:
            # No cache (first run, main not analyzed): an honest full analyze, not a silent wait.
            return False
        self.progress = "reusing the main workspace's parse"
        if not self.engine.seed(snapshot, str(self.root)):
            return False
        divergent = self.divergent_files()
        self.progress = f"reanalyzing {len(divergent)} changed file(s)"
        self.engine.reanalyze(divergent)
        return True

    def divergent_files(self) -> list[str]:
        return self._git.divergent_files()

    def changed_since(self, base_commit: str | None) -> list[str]:
        return self._git.changed_since(base_commit)

    def diff_base(self) -> str:
        return self._git.diff_base()

    def sync(self) -> list[str] | None:
        return self._git.sync()

    def head_changed(self) -> bool:
        return self._git.head_changed()

    def emit(self, message: dict) -> None:
        """Tags the ping with this workspace's id; `main`'s pings stay bare, as before."""
        # An absent key means "main" on the canvas side, so main's wire format never moved.
        if self.id != MAIN_ID:
            message = {**message, "workspace": self.id}
        self.on_event(message)


class WorkspaceRegistry:
    """Maps a `repo_id` onto a Workspace: `main` at startup, agent worktrees registered and lazy."""

    def __init__(self, main_root: Path, on_event: OnKeyedEvent) -> None:
        self._on_event = on_event
        self._roots: dict[str, Path] = {MAIN_ID: main_root}
        # Per-id Workspace.create kwargs, kept beside the root so a lazy bring-up still gets them.
        self._options: dict[str, dict] = {}
        self._live: dict[str, Workspace] = {}
        self._lock = threading.RLock()
        self._threads: dict[str, threading.Thread] = {}
        self._states: dict[str, dict] = {}
        self._touched: dict[str, float] = {}
        # workspace_id -> the id whose _live/_states/_threads entry an attach-shared root uses.
        self._canonical: dict[str, str] = {MAIN_ID: MAIN_ID}
        self._aliases: dict[str, set[str]] = {MAIN_ID: {MAIN_ID}}
        self._main = self._bring_up(MAIN_ID)

    @property
    def main(self) -> Workspace:
        return self._main

    def get(self, repo_id: str) -> Workspace:
        """The workspace for `repo_id`, built on first access; `main` for an unregistered id."""
        # ⚠ Blocks the caller for the whole bring-up on purpose (ensure_async is the async door).
        canonical = self._canonical.get(repo_id, repo_id)
        with self._lock:
            pending = self._threads.get(canonical)
            if pending is None or not pending.is_alive():
                live = self._live.get(canonical)
                if live is not None:
                    self._touched[canonical] = time.monotonic()
                    return live
                if canonical not in self._roots:
                    return self._main
                # Registered+started under ensure_async's lock/thread so a racing call joins this.
                pending = threading.Thread(
                    target=self._bring_up_quietly, args=(canonical,),
                    name=f"codechroma-workspace-{canonical}", daemon=True,
                )
                self._threads[canonical] = pending
                self._states[canonical] = {
                    "state": STATE_ANALYZING, "progress": "starting", "error": None
                }
                pending.start()
        pending.join()
        with self._lock:
            live = self._live.get(canonical)
            if live is not None:
                self._touched[canonical] = time.monotonic()
                return live
            error = self._states.get(canonical, {}).get("error")
        raise RuntimeError(error or f"workspace {repo_id} failed to come up")

    def register(
        self,
        workspace_id: str,
        root: Path,
        *,
        base_ref: str | None = None,
        read_only: bool = False,
        c1_source_root: Path | None = None,
        shares_workspace_with: str | None = None,
    ) -> None:
        """Records where a workspace lives; `shares_workspace_with` reuses another id's live one."""
        with self._lock:
            canonical = (
                workspace_id
                if shares_workspace_with is None
                else self._canonical.get(shares_workspace_with, shares_workspace_with)
            )
            self._roots[workspace_id] = root
            self._options[workspace_id] = {
                "base_ref": base_ref,
                "read_only": read_only,
                "c1_source_root": c1_source_root,
            }
            self._canonical[workspace_id] = canonical
            self._aliases.setdefault(canonical, {canonical}).add(workspace_id)

    def root_for(self, workspace_id: str) -> Path | None:
        """The registered root, or None for an unknown id — never a silent fall back to main."""
        return self._roots.get(workspace_id)

    def is_read_only(self, workspace_id: str) -> bool:
        """Whether writes into this workspace are refused; unknown ids are not read-only."""
        canonical = self._canonical.get(workspace_id, workspace_id)
        options = self._options.get(canonical)
        return bool(options and options.get("read_only"))

    def _join_pending(self, workspace_id: str) -> None:
        """Waits for a bring-up already in flight rather than racing or duplicating it."""
        pending = self._threads.get(workspace_id)
        if pending is not None and pending.is_alive():
            pending.join()

    def drop_live(self, workspace_id: str) -> bool:
        """Unloads a live workspace, keeping its registration so the next access re-analyzes it."""
        canonical = self._canonical.get(workspace_id, workspace_id)
        if canonical == MAIN_ID:
            return False
        # Joined first: an analyze still writing graph.db must finish before its root disappears.
        self._join_pending(canonical)
        with self._lock:
            workspace = self._live.pop(canonical, None)
            self._touched.pop(canonical, None)
            self._states.pop(canonical, None)
        if workspace is None:
            return False
        workspace.stop_watchers()
        workspace.engine.close()  # an open graph.db would block deleting the worktree on Windows
        return True

    def ensure_async(self, workspace_id: str) -> dict:
        """Starts a bring-up in the background and returns its state, so the UI shows progress."""
        canonical = self._canonical.get(workspace_id, workspace_id)
        with self._lock:
            if canonical not in self._roots:
                return {"state": STATE_ERROR, "progress": "", "error": "unknown workspace"}
            if canonical in self._live:
                self._touched[canonical] = time.monotonic()
                return self.state(canonical)
            pending = self._threads.get(canonical)
            if pending is not None and pending.is_alive():
                return self.state(canonical)
            self._states[canonical] = {
                "state": STATE_ANALYZING, "progress": "starting", "error": None
            }
            thread = threading.Thread(
                target=self._bring_up_quietly, args=(canonical,),
                name=f"codechroma-workspace-{canonical}", daemon=True,
            )
            self._threads[canonical] = thread
            # Started under the same lock: is_alive() is reliable for any racing get() check.
            thread.start()
        return dict(self._states[canonical])

    def state(self, workspace_id: str) -> dict:
        """`analyzing` / `ready` / `error` plus a progress line — never a silent wait."""
        canonical = self._canonical.get(workspace_id, workspace_id)
        live = self._live.get(canonical)
        if live is not None:
            return {"state": live.state, "progress": live.progress, "error": live.error}
        recorded = self._states.get(canonical)
        if recorded is not None:
            return dict(recorded)
        if canonical in self._roots:
            return {"state": STATE_ANALYZING, "progress": "not started", "error": None}
        return {"state": STATE_ERROR, "progress": "", "error": "unknown workspace"}

    def unload_idle(self, max_idle_seconds: float | None = None) -> list[str]:
        """Drops workspaces nobody has touched lately; `.codechroma/graph.db` keeps their work."""
        if max_idle_seconds is None:
            max_idle_seconds = _idle_unload_seconds()
        now = time.monotonic()
        with self._lock:
            stale = [
                workspace_id for workspace_id, touched in self._touched.items()
                if workspace_id != MAIN_ID and now - touched >= max_idle_seconds
            ]
        return [workspace_id for workspace_id in stale if self.drop_live(workspace_id)]

    def _bring_up_quietly(self, workspace_id: str) -> None:
        """Thread body: a failed bring-up becomes an error state, never an unhandled exception."""
        try:
            self._bring_up(workspace_id)
        except Exception as exc:
            # Under the lock like every other writer of _states; this was the one that wasn't.
            with self._lock:
                self._states[workspace_id] = {
                    "state": STATE_ERROR, "progress": "", "error": str(exc)
                }
            logger.exception("workspace %s: bring-up failed", workspace_id)

    def unregister(self, workspace_id: str) -> None:
        """Drops a registration; stops its watchers once no alias still shares that root."""
        if workspace_id == MAIN_ID:
            return
        with self._lock:
            canonical = self._canonical.pop(workspace_id, workspace_id)
            members = self._aliases.get(canonical)
            if members is not None:
                members.discard(workspace_id)
            last_alias = not members
            if last_alias:
                self._aliases.pop(canonical, None)
                # No alias resolves to `canonical` anymore, even if it outlived its own unregister.
                self._roots.pop(canonical, None)
                self._options.pop(canonical, None)
            elif workspace_id == canonical:
                # Canonical removed but aliases survive: repoint live state so it stops resolving.
                assert members is not None  # last_alias is False here, so members is non-empty
                canonical = self._repoint_canonical(canonical, members)
            # `canonical`'s own entry stays alive above while aliases remain.
            if workspace_id != canonical:
                self._roots.pop(workspace_id, None)
                self._options.pop(workspace_id, None)
        if last_alias:
            self.drop_live(canonical)

    def _repoint_canonical(self, old_canonical: str, survivors: set[str]) -> str:
        """Moves a removed canonical's live state onto a surviving alias, so the old id stops."""
        new_canonical = next(iter(survivors))
        for alias in survivors:
            self._canonical[alias] = new_canonical
        self._aliases[new_canonical] = survivors
        self._aliases.pop(old_canonical, None)
        self._roots.pop(old_canonical, None)
        self._options.pop(old_canonical, None)
        # Unrolled: the four dicts have different value types, so a loop over them isn't type-safe.
        if old_canonical in self._live:
            self._live[new_canonical] = self._live.pop(old_canonical)
        if old_canonical in self._states:
            self._states[new_canonical] = self._states.pop(old_canonical)
        if old_canonical in self._threads:
            self._threads[new_canonical] = self._threads.pop(old_canonical)
        if old_canonical in self._touched:
            self._touched[new_canonical] = self._touched.pop(old_canonical)
        return new_canonical

    def is_registered(self, workspace_id: str) -> bool:
        return workspace_id in self._roots

    def is_live(self, workspace_id: str) -> bool:
        return self._canonical.get(workspace_id, workspace_id) in self._live

    def live_workspaces(self) -> list[Workspace]:
        return list(self._live.values())

    def start_all(self) -> None:
        for workspace in self.live_workspaces():
            workspace.start_watchers()

    def stop_all(self) -> None:
        for workspace in self.live_workspaces():
            workspace.stop_watchers()

    def __len__(self) -> int:
        """How many workspaces are actually live — registered-but-never-opened ones don't count."""
        return len(self._live)

    def _bring_up(self, workspace_id: str) -> Workspace:
        """Builds and analyzes one workspace, seeding an agent's from the main checkout's parse."""
        options = self._options.get(workspace_id, {})

        def on_event(message: dict, _key: str = workspace_id) -> None:
            # Keyed per workspace, so a ping only reaches the sockets watching this repo id.
            self._on_event(message, _key)

        workspace = Workspace.create(
            workspace_id, self._roots[workspace_id], on_event, **options
        )
        with self._lock:
            self._live[workspace_id] = workspace
            self._touched[workspace_id] = time.monotonic()
        # getattr: main itself is brought up from __init__, before _main is assigned.
        main = getattr(self, "_main", None)
        seed = main.engine if workspace_id != MAIN_ID and main is not None else None
        try:
            workspace.analyze(seed_from=seed)
        except Exception:
            with self._lock:
                self._live.pop(workspace_id, None)
            raise
        # main's watchers belong to the lifespan; an agent comes up later, so it starts its own.
        if workspace_id != MAIN_ID:
            workspace.start_watchers()
        return workspace
