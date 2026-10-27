"""The branch-workspace registry: `.codechroma/branches.json`, one worktree per record."""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path

from codechroma.bridge import diagram_seed, skill_sync
from codechroma.bridge.agents import main_branch, publish, worktree
from codechroma.bridge.git_cmd import ensure_excluded, run_git, run_git_raw
from codechroma.bridge.workspaces import BRANCH_ID_PREFIX
from codechroma.errors import codechromaError
from codechroma.io import load_json, utc_now_iso, write_json

logger = logging.getLogger("uvicorn.error")

REGISTRY_VERSION = 1

FETCH_TIMEOUT_SECONDS = 20
AUTO_NAME_PREFIX = "wt-"


class UnknownBranchWorkspaceError(codechromaError, KeyError):
    """No branch workspace with that id."""


class BranchInUseError(codechromaError):
    """The branch is already checked out somewhere, so a second worktree for it is impossible."""

    def __init__(self, branch: str, holder: str | None) -> None:
        super().__init__(f"branch {branch!r} is already open in {holder or 'another worktree'}")
        self.branch = branch
        self.holder = holder


@dataclass
class BranchRecord:
    """One branch opened in its own worktree."""

    id: str
    branch: str
    worktree: str
    created_at: str
    # The tab's display name; the id and the worktree path never follow a rename.
    name: str = ""
    # Runtime only, recomputed at startup: the directory was deleted by hand.
    worktree_lost: bool = False
    # Runtime only: uncommitted entries in the worktree, filled in by payloads().
    dirty: int = 0

    def to_json(self) -> dict:
        data = asdict(self)
        data.pop("worktree_lost")
        data.pop("dirty")
        return data

    def to_payload(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, raw: object) -> BranchRecord | None:
        """One record from disk, or None when it can't be trusted."""
        if not isinstance(raw, dict):
            return None
        values = {key: raw.get(key) for key in ("id", "branch", "worktree", "created_at")}
        if not all(isinstance(value, str) and value for value in values.values()):
            return None
        if not values["id"].startswith(BRANCH_ID_PREFIX):
            return None
        name = raw.get("name")
        return cls(**values, name=name if isinstance(name, str) and name else values["branch"])


class BranchManager:
    """Owns branches.json and creates/removes the worktree behind each record."""

    def __init__(self, main_root: Path) -> None:
        self.main_root = main_root.resolve()
        self._lock = threading.RLock()
        self._records: dict[str, BranchRecord] = {}
        self._active: str | None = None
        self._load()

    @property
    def registry_path(self) -> Path:
        return self.main_root / ".codechroma" / "branches.json"

    def _load(self) -> None:
        raw = load_json(self.registry_path)
        entries = raw.get("branches") if isinstance(raw, dict) else None
        for entry in entries if isinstance(entries, list) else []:
            record = BranchRecord.from_json(entry)
            if record is not None:
                self._records[record.id] = record
        active = raw.get("active") if isinstance(raw, dict) else None
        self._active = active if isinstance(active, str) and active in self._records else None

    def save(self) -> None:
        payload = {
            "version": REGISTRY_VERSION,
            "branches": [record.to_json() for record in self._records.values()],
            "active": self._active,
        }
        write_json(self.registry_path, payload)

    def list(self) -> list[BranchRecord]:
        return list(self._records.values())

    @property
    def active(self) -> str | None:
        return self._active

    def find_by_id(self, workspace_id: str) -> BranchRecord | None:
        return self._records.get(workspace_id)

    def set_active(self, workspace_id: str) -> None:
        """Remembers which tab is in front; raises UnknownBranchWorkspaceError for a stranger."""
        with self._lock:
            self.get(workspace_id)
            self._active = workspace_id
        self.save()

    def count_dirty(self, record: BranchRecord) -> int:
        """Uncommitted entries (modified, staged or untracked) in the tab's worktree."""
        if record.worktree_lost:
            return 0
        return len(publish.dirty_files(Path(record.worktree)))

    def payloads(self) -> list[dict]:
        """Every record as the API reports it, with the live dirty count."""
        records = list(self._records.values())
        if records:
            with ThreadPoolExecutor(max_workers=min(len(records), 8)) as pool:
                for record, dirty in zip(records, pool.map(self.count_dirty, records), strict=True):
                    record.dirty = dirty
        return [record.to_payload() for record in records]

    def get(self, workspace_id: str) -> BranchRecord:
        record = self._records.get(workspace_id)
        if record is None:
            raise UnknownBranchWorkspaceError(workspace_id)
        return record

    def reconcile(self) -> None:
        """Flags a record whose directory vanished and re-syncs skills into the ones that remain."""
        if not self._records:
            return
        worktree.prune(self.main_root)
        for record in self._records.values():
            record.worktree_lost = not Path(record.worktree).is_dir()
            if record.worktree_lost:
                logger.warning("branches: worktree missing for %s", record.id)
            else:
                skill_sync.install_into_worktree(Path(record.worktree), "branches")

    def ensure_any(self) -> list[BranchRecord]:
        """Creates `wt-1` only when there are no records; otherwise changes nothing."""
        with self._lock:
            if not self._records:
                self.create_next()
            if self._active not in self._records:
                self._active = next(reversed(self._records))
                self.save()
            return self.list()

    def create_next(self, name: str | None = None) -> tuple[BranchRecord, bool, str | None]:
        """A new tab off fresh main: (record, fetched, warning); auto-names the first free wt-N."""
        # The slow fetch runs before the lock so set_active/rename/delete are never blocked on it.
        start_point, fetched, warning = self.refresh_base()
        with self._lock:
            existing = set(main_branch.list_branches(self.main_root))
            branch = (
                self._validated_name(name, existing)
                if name is not None
                else self._next_auto_name(existing)
            )
            record = self._provision(branch, start_point)
            self._active = record.id
            self.save()
            return record, fetched, warning

    def refresh_base(self) -> tuple[str, bool, str | None]:
        """(start point, fetched, warning): origin/default, else the local default, else HEAD."""
        default = worktree.main_branch(self.main_root)
        remotes = run_git(self.main_root, "remote")
        warning: str | None = None
        if remotes is not None and "origin" in remotes.split():
            env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
            result = run_git_raw(
                self.main_root, "fetch", "origin", default,
                env=env, timeout=FETCH_TIMEOUT_SECONDS,
            )
            if result is not None and result.returncode == 0:
                return f"origin/{default}", True, None
            detail = (result.stderr or "").strip() if result is not None else "timed out"
            warning = f"could not fetch origin/{default}: {detail or 'fetch failed'}"
        if run_git(self.main_root, "rev-parse", "--verify", "--quiet", f"refs/heads/{default}"):
            return default, False, warning
        return "HEAD", False, warning

    def rename(
        self, workspace_id: str, name: str, holders: Callable[[], dict[str, str | None]]
    ) -> BranchRecord:
        """Renames the display name and the git branch; id and worktree path stay put."""
        with self._lock:
            record = self.get(workspace_id)
            new = name.strip() if isinstance(name, str) else ""
            if new != record.branch:
                existing = set(main_branch.list_branches(self.main_root))
                self._validated_name(name, existing, holders)
                worktree.rename_branch(self.main_root, record.branch, new)
                record.branch = new
            record.name = new
        self.save()
        return record

    def _validated_name(
        self,
        name: str,
        existing: set[str],
        holders: Callable[[], dict[str, str | None]] | None = None,
    ) -> str:
        """A trimmed, git-valid branch name nothing else uses, else a 409-class error."""
        branch = name.strip() if isinstance(name, str) else ""
        if not _valid_branch_name(self.main_root, branch):
            raise worktree.WorktreeError(f"{name!r} is not a valid branch name")
        taken = holders() if holders is not None else {}
        if branch in taken:
            raise BranchInUseError(branch, taken[branch])
        if branch in existing:
            holder = next((r.id for r in self._records.values() if r.branch == branch), None)
            raise BranchInUseError(branch, holder)
        return branch

    def _next_auto_name(self, existing: set[str]) -> str:
        """The first `wt-N` no record, git branch or leftover directory is using."""
        used = {record.name for record in self._records.values()}
        used |= {record.branch for record in self._records.values()}
        used |= existing
        number = 1
        while (
            f"{AUTO_NAME_PREFIX}{number}" in used
            or worktree.worktree_path(
                self.main_root, f"{BRANCH_ID_PREFIX}{AUTO_NAME_PREFIX}{number}"
            ).exists()
        ):
            number += 1
        return f"{AUTO_NAME_PREFIX}{number}"

    def _provision(self, branch: str, start_point: str | None) -> BranchRecord:
        with self._lock:
            workspace_id = self._unique_id(branch)
            path = worktree.worktree_path(self.main_root, workspace_id)
            # Before `add`: an unexcluded nested worktree reads to GitSync as thousands of files.
            ensure_excluded(self.main_root, skill_sync.WORKTREE_EXCLUDES)
            worktree.add(self.main_root, branch, path, start_point=start_point, track=False)
            try:
                self._prepare(path)
            except Exception:
                # Never leave a checkout (and a branch we just made) that no record points at.
                self._undo_provision(branch, path)
                raise
            record = BranchRecord(
                id=workspace_id,
                branch=branch,
                worktree=str(path),
                created_at=utc_now_iso(),
                name=branch,
            )
            self._records[workspace_id] = record
        self.save()
        return record

    def _prepare(self, path: Path) -> None:
        skill_sync.install_into_worktree(path, "branches")
        try:
            diagram_seed.seed_diagrams_from_main(self.main_root, path)
        except OSError:
            logger.exception("branches: could not seed diagrams into %s", path)

    def _undo_provision(self, branch: str, path: Path) -> None:
        try:
            worktree.remove(self.main_root, path, force=True)
            worktree.delete_branch(self.main_root, branch)
        except worktree.WorktreeError:
            logger.exception("branches: could not clean up the half-made worktree %s", path)

    def delete(self, workspace_id: str, remove_worktree: bool = False) -> BranchRecord:
        """Forgets the record; the directory goes only on request, and the branch never does."""
        with self._lock:
            record = self.get(workspace_id)
            if remove_worktree:
                worktree.remove(self.main_root, Path(record.worktree), force=True)
            self._records.pop(workspace_id, None)
            if self._active == workspace_id:
                self._active = next(reversed(self._records), None)
        self.save()
        return record

    def _unique_id(self, branch: str) -> str:
        """`br_<slug>`, suffixed until neither a record nor a leftover directory holds it."""
        slug = worktree.slugify(branch, fallback_index=len(self._records) + 1)
        base = f"{BRANCH_ID_PREFIX}{slug}"
        candidate, suffix = base, 2
        while (
            candidate in self._records or worktree.worktree_path(self.main_root, candidate).exists()
        ):
            candidate = f"{base}-{suffix}"
            suffix += 1
        return candidate


def _valid_branch_name(root: Path, branch: str) -> bool:
    """Git's own verdict on a branch name, so we never reimplement `check-ref-format`."""
    if not branch.strip() or branch.startswith("-"):
        return False
    result = run_git_raw(root, "check-ref-format", "--branch", branch)
    return result is not None and result.returncode == 0
