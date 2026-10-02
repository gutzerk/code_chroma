"""The agent registry, worktree creation, and the 5-agent cap.

The file lives in the *main* repository rather than in a worktree, because it is a list spanning all
worktrees. An agent's own artifacts (c1.json, …) are not in here: they already sit in the
`.codechroma/` of the agent's own worktree, so they separate without a line of new code.

`AgentManager` owns the registry; two smaller collaborators own what used to share its class body:
`WorktreeProvisioner` (create/attach/recreate/migrate + skill install + diagram seeding) and
`ActiveWorkspace` (which workspace the canvas is looking at). All three public names the routes and
tests use stay on `AgentManager`, delegating to those helpers, so the split never moves a caller.

🔴 There is no `base_commit` field. The divergence point is `git merge-base <main> HEAD`,
computed on demand — a stored hash goes stale the moment the agent pulls main into its branch.
"""

from __future__ import annotations

import logging
import os
import re
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, cast

from codechroma.bridge import diagram_seed, skill_sync
from codechroma.bridge.agents import main_branch, transcripts, worktree
from codechroma.bridge.agents.worktree import WorktreeError
from codechroma.bridge.git_cmd import ensure_excluded
from codechroma.bridge.workspaces import MAIN_ID, PR_ID_PREFIX
from codechroma.config import settings
from codechroma.errors import codechromaError
from codechroma.io import load_json, write_json

if TYPE_CHECKING:
    from codechroma.bridge.prs.manager import PrRecord

logger = logging.getLogger("uvicorn.error")

# Each agent is its own in-memory GraphEngine plus subscription spend; revisit with measurements.
REGISTRY_VERSION = 1


def max_agents() -> int:
    return settings.agents.max_agents

DEFAULT_KIND = "claude"

DEFAULT_WINDOW = {"x": 120, "y": 120, "width": 720, "height": 480, "minimized": False, "z": 1}

STATUS_STOPPED = "stopped"
STATUS_RUNNING = "running"
STATUS_EXITED = "exited"

_PERSISTED_FIELDS = (
    "id", "title", "kind", "branch", "worktree", "session_id", "created_at",
    "pr_url", "window", "pid", "shares_workspace_with", "base_branch", "source_pr",
    "context", "context_kind", "resolved_cli",
)

# "view" = existing acknowledge-only launch line; "task" = a real, actionable first message.
CONTEXT_KINDS = ("view", "task")


def _coerce_context_kind(value: object) -> str:
    """Anything not a recognized `CONTEXT_KINDS` member falls back to the default, "view"."""
    return value if value in CONTEXT_KINDS else "view"


def _coerce_resolved_cli(value: object) -> str:
    """Anything not a string falls back to the empty default (a `claude` record, or pre-061)."""
    return value if isinstance(value, str) else ""


# 🔴 A control char here is a real keystroke: inject_when_idle types this into a live PTY.
def _clean_context(value: object) -> str | None:
    """One-line, control-character-free context, or None when nothing usable is left."""
    if not isinstance(value, str):
        return None
    # Replaced with a space rather than dropped, so "a\nb" stays two words instead of becoming "ab".
    spaced = "".join(" " if _is_control(char) else char for char in value)
    return " ".join(spaced.split()) or None


def _is_control(char: str) -> bool:
    """C0 (incl. CR/LF/ESC), DEL and C1 -- every code point a terminal reads as a command."""
    return char < " " or "\x7f" <= char <= "\x9f"

# Exactly what prs.manager mints: anything wider and _unique_id's own `-2` suffix never converges.
_PR_WORKSPACE_ID = re.compile(rf"{re.escape(PR_ID_PREFIX)}\d+")


def _shadows_a_workspace(agent_id: str) -> bool:
    """Whether this id already names a non-agent workspace, making such an agent unreachable."""
    # 🔴 `main` is the main repo and `pr-<number>` a fetched PR; shadowing either hides the agent.
    return agent_id == MAIN_ID or _PR_WORKSPACE_ID.fullmatch(agent_id) is not None


class AgentLimitError(codechromaError):
    """The hard limit of live agents is reached; the route turns this into a 409."""


class UnknownAgentError(codechromaError, KeyError):
    """No agent with that id is registered."""


@dataclass
class AgentRecord:
    """One row of agents.json plus the runtime fields the API reports but never persists."""

    id: str
    title: str
    kind: str
    branch: str
    worktree: str
    created_at: str
    session_id: str | None = None
    pr_url: str | None = None
    pid: int | None = None
    window: dict = field(default_factory=lambda: dict(DEFAULT_WINDOW))
    # The `attach_to` id this agent's worktree/branch is shared with; None for its own worktree.
    shares_workspace_with: str | None = None
    # Which of main's branches this agent belongs to; None for records written before the field.
    base_branch: str | None = None
    # The `pr-<n>` this agent was forked from, if any; None for every other agent.
    source_pr: str | None = None
    # The acknowledge-only "current view" description handed to the agent on its FIRST fresh start,
    # then cleared. Never re-injected by autostart or a resume — see routes/agents.post_agent_start.
    context: str | None = None
    # "view" (default) wraps `context`; "task" hands it to the launched CLI's own argv, verbatim.
    context_kind: str = "view"
    # Binary that launched this window; empty for legacy `claude` records.
    resolved_cli: str = ""
    # Runtime-only: recomputed every startup, so persisting them would just let them go stale.
    status: str = STATUS_STOPPED
    exit_code: int | None = None
    worktree_lost: bool = False

    def to_json(self) -> dict:
        """Only the persisted subset — status/worktree_lost are derived at startup, never stored."""
        return {key: value for key, value in asdict(self).items() if key in _PERSISTED_FIELDS}

    def to_payload(self) -> dict:
        """What `GET /agents` reports: the record plus its live status and worktree health."""
        return asdict(self)

    @classmethod
    def from_json(cls, raw: object) -> AgentRecord | None:
        """One record from disk, or None when the entry is missing the fields that identify it."""
        if not isinstance(raw, dict):
            return None
        agent_id, title = raw.get("id"), raw.get("title")
        branch, path = raw.get("branch"), raw.get("worktree")
        if not all(isinstance(value, str) and value for value in (agent_id, title, branch, path)):
            return None
        window = raw.get("window")
        raw_kind = raw.get("kind")
        raw_created_at = raw.get("created_at")
        return cls(
            id=cast(str, agent_id),
            title=cast(str, title),
            kind=raw_kind if isinstance(raw_kind, str) else DEFAULT_KIND,
            branch=cast(str, branch),
            worktree=cast(str, path),
            created_at=raw_created_at if isinstance(raw_created_at, str) else "",
            session_id=raw.get("session_id") if isinstance(raw.get("session_id"), str) else None,
            pr_url=raw.get("pr_url") if isinstance(raw.get("pr_url"), str) else None,
            pid=raw.get("pid") if isinstance(raw.get("pid"), int) else None,
            window=({**DEFAULT_WINDOW, **window} if isinstance(window, dict)
                    else dict(DEFAULT_WINDOW)),
            shares_workspace_with=(
                raw.get("shares_workspace_with")
                if isinstance(raw.get("shares_workspace_with"), str) else None
            ),
            base_branch=(
                raw.get("base_branch") if isinstance(raw.get("base_branch"), str) else None
            ),
            source_pr=raw.get("source_pr") if isinstance(raw.get("source_pr"), str) else None,
            context=_clean_context(raw.get("context")),
            context_kind=_coerce_context_kind(raw.get("context_kind")),
            resolved_cli=_coerce_resolved_cli(raw.get("resolved_cli")),
        )


class WorktreeProvisioner:
    """Create/attach/recreate/migrate of agent worktrees plus skill install and diagram seeding.

    Every operation mutates the git repo and the worktree on disk; it reaches back into the owning
    `AgentManager` for the recorded agents and the ID/name rules, but holds no registry state of its
    own.
    """

    def __init__(self, manager: AgentManager) -> None:
        self._m = manager

    @property
    def main_root(self) -> Path:
        return self._m.main_root

    def new_worktree(self, agent_id: str, start_point: str | None = None) -> tuple[str, Path]:
        """Forks a fresh branch/worktree for agent_id, seeded from start_point if given."""
        branch = worktree.branch_name(agent_id)
        path = worktree.worktree_path(self.main_root, agent_id)
        # Before `add`: an unexcluded nested worktree reads to GitSync as thousands of files.
        ensure_excluded(self.main_root, skill_sync.WORKTREE_EXCLUDES)
        worktree.add(self.main_root, branch, path, start_point=start_point)
        self.install_skills(path)
        self.seed_diagrams(path)
        return branch, path

    def attach_to(self, attach_to: str) -> tuple[str, Path]:
        """The branch/worktree an attach-created agent shares — main's own, or another agent's."""
        if attach_to == MAIN_ID:
            branch = main_branch.current_branch(self.main_root)
            if branch is None:
                raise WorktreeError("main has no checked-out branch to attach to (detached HEAD)")
            return branch, self.main_root
        target = self._m.get(attach_to)
        return target.branch, Path(target.worktree)

    def recreate_worktree(self, agent_id: str) -> None:
        """Checks the agent's branch out again after its directory was deleted by hand."""
        record = self._m.get(agent_id)
        path = Path(record.worktree)
        if path.is_dir():
            return
        worktree.prune(self.main_root)
        worktree.attach(self.main_root, record.branch, path)
        self.install_skills(path)
        self.seed_diagrams(path)

    def migrate_worktrees(self) -> list[tuple[Path, Path]]:
        """Relocates every worktree still under the old `~/.codechroma/worktrees` into the repo."""
        if os.environ.get(worktree.WORKSPACES_DIR_ENV, "").strip():
            return []
        legacy_root = worktree.legacy_worktrees_root()
        target_root = worktree.worktrees_root(self.main_root)
        moved: list[tuple[Path, Path]] = []
        for entry in worktree.list_worktrees(self.main_root):
            source = Path(entry.get("path") or "")
            if not self._is_legacy(source, legacy_root):
                continue
            target = target_root / source.name
            if target.exists():
                logger.warning("agents: not migrating %s, %s already exists", source, target)
                continue
            try:
                worktree.move(self.main_root, source, target)
            except worktree.WorktreeError:
                logger.exception("agents: could not migrate worktree %s", source)
                continue
            logger.info("agents: migrated worktree %s -> %s", source, target)
            moved.append((source, target))
            self._m._repoint(source, target)
        if moved:
            self._m.save()
            _remove_if_empty(moved[0][0].parent)
        return moved

    @staticmethod
    def _is_legacy(source: Path, legacy_root: Path) -> bool:
        """True for a path under the old root that still exists; a gone one is `worktree_lost`."""
        return source.is_dir() and legacy_root in source.parents

    def install_skills(self, root: Path) -> None:
        """A worktree is a different directory, so the launcher's skill sync never reaches it."""
        skill_sync.install_into_worktree(root, "agents")

    def seed_diagrams(self, root: Path) -> None:
        """So a new agent opens with main's last diagrams instead of triggering a fresh run."""
        try:
            diagram_seed.seed_diagrams_from_main(self.main_root, root)
        except OSError:
            logger.exception("agents: could not seed diagrams into %s", root)


class ActiveWorkspace:
    """Which workspace the canvas is drawing — main, an agent, or a registered non-agent one."""

    def __init__(self, manager: AgentManager) -> None:
        self._m = manager
        self._active_workspace = MAIN_ID
        # An active id from disk that isn't an agent's; revalidate() decides it.
        self._pending_active: str | None = None
        # "Can the canvas draw this id?" for ids this manager knows nothing about, e.g. a PR's.
        self.workspace_guard: Callable[[str], bool] = lambda _workspace_id: False

    @property
    def current(self) -> str:
        return self._active_workspace

    def adopt_persisted(self, raw: object) -> None:
        """Applies the `active_workspace` value read from agents.json at startup."""
        active = raw if isinstance(raw, str) and raw else None
        if not active:
            return
        if active == MAIN_ID or active in self._m._agents:
            self._active_workspace = active
        else:
            # Deferred, not discarded: a `pr-12` here used to fall back to main without a word.
            self._pending_active = active

    def set(self, workspace_id: str) -> None:
        """Records what the canvas is drawing: main, a known agent, or a registered workspace."""
        if (
            workspace_id != MAIN_ID
            and workspace_id not in self._m._agents
            and not self.workspace_guard(workspace_id)
        ):
            raise UnknownAgentError(workspace_id)
        self._active_workspace = workspace_id
        self._m.save()

    def revert_to_main(self) -> None:
        """When the active agent is deleted, the canvas falls back to the main workspace."""
        if self._active_workspace in self._m._agents:
            self._active_workspace = MAIN_ID
            self._m.save()

    def revalidate(self) -> None:
        """Promotes an active id deferred at load once every non-agent workspace is registered."""
        pending, self._pending_active = self._pending_active, None
        if pending is None:
            return
        if self.workspace_guard(pending):
            self._active_workspace = pending
            return
        logger.warning("agents: active workspace %r is gone, falling back to %r", pending, MAIN_ID)
        self._m.save()


# AgentManager.list (the method) shadows the builtin `list` for annotations inside the class body.
_MigrationPairs = list[tuple[Path, Path]]


class AgentManager:
    """Owns agents.json, the worktree per agent, and which workspace the canvas is looking at."""

    def __init__(self, main_root: Path) -> None:
        self.main_root = main_root.resolve()
        # Serializes _agents mutations: they occur from the event loop AND worktree threads.
        self._lock = threading.RLock()
        self._agents: dict[str, AgentRecord] = {}
        self._active = ActiveWorkspace(self)
        self._provisioner = WorktreeProvisioner(self)
        # Resolves a `pr-<n>` attach_to to the PR it names, so create() can fork from its head.
        self.pr_lookup: Callable[[str], PrRecord | None] = lambda _pr_id: None
        self._load()

    # --- persistence ---

    @property
    def registry_path(self) -> Path:
        return self.main_root / ".codechroma" / "agents.json"

    @property
    def active_workspace(self) -> str:
        return self._active.current

    @property
    def workspace_guard(self) -> Callable[[str], bool]:
        """"Can the canvas draw this id?" for ids this manager knows nothing about, e.g. a PR's."""
        return self._active.workspace_guard

    @workspace_guard.setter
    def workspace_guard(self, value: Callable[[str], bool]) -> None:
        self._active.workspace_guard = value

    def _load(self) -> None:
        """Reads agents.json, tolerating a missing or malformed file as the bridge already does."""
        with self._lock:
            raw = load_json(self.registry_path)
            entries = raw.get("agents") if isinstance(raw, dict) else None
            if isinstance(entries, list):
                for entry in entries:
                    record = AgentRecord.from_json(entry)
                    if record is not None:
                        self._agents[record.id] = record
            active = raw.get("active_workspace") if isinstance(raw, dict) else None
            self._active.adopt_persisted(active)

    def save(self) -> None:
        """Atomic temp+rename — a half-written registry would lose every agent card."""
        with self._lock:
            payload = {
                "version": REGISTRY_VERSION,
                "agents": [record.to_json() for record in self._agents.values()],
                "active_workspace": self._active.current,
            }
        write_json(self.registry_path, payload)

    # --- reads ---

    def attached_to_pr(self, pr_id: str) -> list[AgentRecord]:
        """Live agents reviewing `pr_id`, so a PR close/refresh can refuse while one is attached."""
        return [record for record in self._agents.values() if record.source_pr == pr_id]

    def list(self) -> list[AgentRecord]:
        for record in self._agents.values():
            self._refresh_live_branch(record)
        return list(self._agents.values())

    def get(self, agent_id: str) -> AgentRecord:
        record = self._agents.get(agent_id)
        if record is None:
            raise UnknownAgentError(agent_id)
        self._refresh_live_branch(record)
        return record

    def _refresh_live_branch(self, record: AgentRecord) -> None:
        """An agent living in main's own tree tracks whatever branch main has checked out now."""
        # Its worktree *is* main_root, so a creation-time snapshot goes stale when main switches.
        if Path(record.worktree).resolve() != self.main_root:
            return
        live = main_branch.current_branch(self.main_root)
        if live is not None:
            record.branch = live
            record.base_branch = live

    # --- writes ---

    def create(
        self,
        title: str,
        kind: str = DEFAULT_KIND,
        attach_to: str | None = None,
        context: str | None = None,
        context_kind: str = "view",
    ) -> AgentRecord:
        """Slug, branch, worktree, record, persist; `attach_to` reuses a target's own worktree."""
        # Context is either the acknowledge-only view description or a real "task" first message.
        context = _clean_context(context)
        context_kind = _coerce_context_kind(context_kind)
        # Whole body under the lock: id reservation must be atomic with insertion, or two
        # threads creating the same title reserve one id and silently evict each other's record.
        with self._lock:
            if len(self._agents) >= max_agents():
                raise AgentLimitError(f"the limit of {max_agents()} concurrent agents is reached")
            agent_id = self._unique_id(title)
            pr_target = self._pr_target(attach_to) if attach_to is not None else None
            source_pr = attach_to if pr_target is not None else None
            # Every attach_to (main, another agent, or a PR) now shares its target's worktree.
            shares_workspace_with = attach_to
            if pr_target is not None:
                if not pr_target.worktree:
                    raise WorktreeError(f"PR {attach_to} has no worktree to attach to")
                branch, path = pr_target.head_ref, Path(pr_target.worktree)
                base_branch: str | None = pr_target.base_ref
            elif attach_to is None:
                branch, path = self._provisioner.new_worktree(agent_id)
                base_branch = self._base_branch_for(attach_to)
            else:
                branch, path = self._provisioner.attach_to(attach_to)
                base_branch = self._base_branch_for(attach_to)
            record = AgentRecord(
                id=agent_id,
                title=title.strip() or agent_id,
                kind=kind,
                branch=branch,
                worktree=str(path),
                created_at=datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
                window={**DEFAULT_WINDOW, "z": len(self._agents) + 1},
                shares_workspace_with=shares_workspace_with,
                base_branch=base_branch,
                source_pr=source_pr,
                context=context,
                context_kind=context_kind,
            )
            self._agents[agent_id] = record
        self.save()
        return record

    def _pr_target(self, attach_to: str) -> PrRecord | None:
        """The PR `attach_to` names, or None when it names main/an agent instead of a PR."""
        if not _PR_WORKSPACE_ID.fullmatch(attach_to):
            return None
        record = self.pr_lookup(attach_to)
        if record is None:
            raise UnknownAgentError(attach_to)
        return record

    def _base_branch_for(self, attach_to: str | None) -> str | None:
        """Which of main's branches the agent belongs to; an attached one inherits its target's."""
        # Own worktree and attach-to-main both fork from whatever main has checked out right now.
        if attach_to is None or attach_to == MAIN_ID:
            return main_branch.current_branch(self.main_root)
        return self.get(attach_to).base_branch

    def delete(self, agent_id: str, remove_worktree: bool = False,
               remove_branch: bool = False, force: bool = False) -> AgentRecord:
        """Both flags default off: the work stays in the branch until the user says otherwise."""
        # One lock, guard-check-to-pop: a concurrent attach can't slot in before it's gone.
        with self._lock:
            record = self.get(agent_id)
            if remove_worktree or remove_branch:
                self._guard_shared_worktree(agent_id, record)
            if remove_worktree:
                worktree.remove(self.main_root, Path(record.worktree), force=force)
            if remove_branch:
                worktree.delete_branch(self.main_root, record.branch)
            self._agents.pop(agent_id, None)
        self._active.revert_to_main()
        self.save()
        return record

    def _guard_shared_worktree(self, agent_id: str, record: AgentRecord) -> None:
        """Refuses to remove a worktree/branch shared with main, a PR, or another agent."""
        if Path(record.worktree) == self.main_root:
            raise WorktreeError("cannot delete main's own worktree or branch through an agent")
        if record.shares_workspace_with is not None:
            raise WorktreeError(
                f"{record.worktree} is shared with {record.shares_workspace_with!r} -- "
                "cannot delete it through this agent"
            )
        sharing = next(
            (other for other_id, other in self._agents.items()
             if other_id != agent_id and other.worktree == record.worktree),
            None,
        )
        if sharing is not None:
            raise WorktreeError(f"{record.worktree} is still in use by agent {sharing.id!r}")

    def mark_started(
        self, agent_id: str, pid: int | None, resolved_cli: str = ""
    ) -> AgentRecord:
        """Records the live pid; an `agent`-kind window's resolved binary rides the same save."""
        record = self.get(agent_id)
        record.pid = pid
        record.status = STATUS_RUNNING
        record.exit_code = None
        if resolved_cli:
            record.resolved_cli = resolved_cli
        self.save()
        return record

    def mark_stopped(self, agent_id: str, exit_code: int | None = None) -> AgentRecord:
        record = self.get(agent_id)
        record.pid = None
        record.status = STATUS_EXITED if exit_code is not None else STATUS_STOPPED
        record.exit_code = exit_code
        self.save()
        return record

    def recreate_worktree(self, agent_id: str) -> AgentRecord:
        """Checks the agent's branch out again after its directory was deleted by hand."""
        record = self.get(agent_id)
        path = Path(record.worktree)
        if path.is_dir():
            self._clear_worktree_lost(path)
            return record
        self._provisioner.recreate_worktree(agent_id)
        self._clear_worktree_lost(path)
        self.save()
        return record

    def _clear_worktree_lost(self, path: Path) -> None:
        """Clears worktree_lost on all records sharing this directory, not just one of them."""
        for sibling in self._agents.values():
            if Path(sibling.worktree) == path:
                sibling.worktree_lost = False

    def capture_session_id(self, agent_id: str) -> str | None:
        """Records the conversation `claude --resume` continues; None while there isn't one."""
        record = self.get(agent_id)
        path = Path(record.worktree)
        exclude = self._sibling_session_ids(record, path)
        found = transcripts.find_session_id(path, exclude=exclude)
        if found and found != record.session_id:
            record.session_id = found
            self.save()
        return record.session_id

    def _sibling_session_ids(self, record: AgentRecord, path: Path) -> frozenset[str]:
        """Session ids another agent sharing this worktree (an attach_to peer) already claimed."""
        return frozenset(
            other.session_id
            for other in self._agents.values()
            if other is not record and other.session_id and Path(other.worktree) == path
        )

    def consume_context(self, agent_id: str) -> tuple[str, str] | None:
        """Pending (context, context_kind), cleared so a resume/restart never re-injects it."""
        record = self.get(agent_id)
        pending = record.context
        if pending is None:
            return None
        kind = record.context_kind
        record.context = None
        self.save()
        return pending, kind

    def update_window(self, agent_id: str, window: object) -> AgentRecord:
        """Merges a geometry patch onto the stored window, dropping keys/types it can't use."""
        record = self.get(agent_id)
        record.window = {**record.window, **_sanitize_window(window)}
        self.save()
        return record

    def set_active_workspace(self, workspace_id: str) -> None:
        self._active.set(workspace_id)

    def revalidate_active_workspace(self) -> None:
        self._active.revalidate()

    # --- startup reconciliation ---

    def reconcile(self) -> None:
        """Renames shadowing ids, relocates legacy worktrees, prunes, then flags vanished ones."""
        self._rename_shadowing_ids()
        self.migrate_worktrees()
        worktree.prune(self.main_root)
        for record in self._agents.values():
            # A surviving pid is an orphan, and pids get recycled — so clear it, never kill it.
            record.pid = None
            record.status = STATUS_STOPPED
            record.exit_code = None
            record.worktree_lost = not Path(record.worktree).is_dir()
            if record.worktree_lost:
                logger.warning("agents: worktree missing for %s at %s", record.id, record.worktree)
            else:
                # Re-sync per launch: a worktree's skills are installed once at create() (the
                # launcher's sync only reaches the main repo), so a skill added to SKILL_NAMES
                # after an agent was made must catch up here. install_skills replaces stale
                # copies, so this is a no-op until a new skill actually appears.
                self._provisioner.install_skills(Path(record.worktree))
                # Backfill for agents created before diagram seeding existed; a no-op once seeded.
                self._provisioner.seed_diagrams(Path(record.worktree))

    def migrate_worktrees(self) -> _MigrationPairs:
        return self._provisioner.migrate_worktrees()

    def _repoint(self, source: Path, target: Path) -> None:
        """Updates whichever record pointed at the old path; an orphan worktree simply has none."""
        for record in self._agents.values():
            if Path(record.worktree) == source:
                record.worktree = str(target)

    def _rename_shadowing_ids(self) -> None:
        """An id that names another workspace makes the agent unselectable; self-retiring repair."""
        shadowing = [
            record for record in self._agents.values() if _shadows_a_workspace(record.id)
        ]
        if not shadowing:
            return
        for record in shadowing:
            with self._lock:
                self._agents.pop(record.id, None)
                record.id = self._unique_id(record.title or MAIN_ID)
                self._agents[record.id] = record
            logger.warning("agents: renamed the agent shadowing %r to %r", MAIN_ID, record.id)
        # `active_workspace: "main"` now unambiguously means the main repo, as it already read.
        self.save()

    def _unique_id(self, title: str) -> str:
        """A slug nothing else is using — not this registry, a shadow, or a leftover worktree."""
        # Prune first: a hand-deleted directory shouldn't block reuse of the id it left behind.
        worktree.prune(self.main_root)
        reserved = self._agents.keys() | self._worktree_ids_in_use()
        base = worktree.slugify(title, fallback_index=len(self._agents) + 1)
        candidate, suffix = base, 2
        while candidate in reserved or _shadows_a_workspace(candidate):
            candidate = f"{base}-{suffix}"
            suffix += 1
        return candidate

    def _worktree_ids_in_use(self) -> set[str]:
        """Agent ids git still holds a worktree or branch for, including ones this registry lost."""
        # `worktree.add -b` fails on either a live worktree or a leftover branch, so check both.
        from_worktrees = {
            branch.removeprefix(worktree.BRANCH_PREFIX)
            for entry in worktree.list_worktrees(self.main_root)
            if (branch := entry.get("branch")) and branch.startswith(worktree.BRANCH_PREFIX)
        }
        from_branches = {
            branch.removeprefix(worktree.BRANCH_PREFIX)
            for branch in worktree.list_agent_branches(self.main_root)
        }
        return from_worktrees | from_branches


def _remove_if_empty(directory: Path) -> None:
    """Drops the leftover `~/.codechroma/worktrees/<repo-slug>` shell once everything moved out."""
    try:
        directory.rmdir()
    except OSError:
        pass


def _sanitize_window(raw: object) -> dict:
    """Keeps only the geometry keys we know, with the types we can render."""
    if not isinstance(raw, dict):
        return {}
    clean: dict = {}
    for key in ("x", "y", "width", "height", "z"):
        value = raw.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            clean[key] = float(value) if key in ("x", "y") else int(value)
    if isinstance(raw.get("minimized"), bool):
        clean["minimized"] = raw["minimized"]
    return clean
