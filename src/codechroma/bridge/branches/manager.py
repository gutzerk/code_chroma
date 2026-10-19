"""The branch-workspace registry: `.codechroma/branches.json`, one worktree per record."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

from codechroma.bridge import diagram_seed, skill_sync
from codechroma.bridge.agents import main_branch, worktree
from codechroma.bridge.git_cmd import ensure_excluded, run_git_raw
from codechroma.bridge.workspaces import BRANCH_ID_PREFIX
from codechroma.errors import codechromaError
from codechroma.io import load_json, utc_now_iso, write_json

logger = logging.getLogger("uvicorn.error")

REGISTRY_VERSION = 1


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
    # Runtime only, recomputed at startup: the directory was deleted by hand.
    worktree_lost: bool = False

    def to_json(self) -> dict:
        data = asdict(self)
        data.pop("worktree_lost")
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
        return cls(**values)


class BranchManager:
    """Owns branches.json and creates/removes the worktree behind each record."""

    def __init__(self, main_root: Path) -> None:
        self.main_root = main_root.resolve()
        self._lock = threading.RLock()
        self._records: dict[str, BranchRecord] = {}
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

    def save(self) -> None:
        payload = {
            "version": REGISTRY_VERSION,
            "branches": [record.to_json() for record in self._records.values()],
        }
        write_json(self.registry_path, payload)

    def list(self) -> list[BranchRecord]:
        return list(self._records.values())

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

    def open_branch(
        self, branch: str, holders: Callable[[], dict[str, str | None]]
    ) -> BranchRecord:
        """Checks the existing local `branch` out into a new worktree and records it."""
        if branch not in main_branch.list_branches(self.main_root):
            raise main_branch.UnknownBranchError(branch)
        with self._lock:
            # Judged under the lock so two racing opens of one branch can't both pass.
            taken = holders()
            if branch in taken:
                raise BranchInUseError(branch, taken[branch])
            return self._provision(branch, create=False, start_point=None)

    def create_branch(self, branch: str, start_point: str | None) -> BranchRecord:
        """Creates `branch` from `start_point` (main's current branch by default) in a worktree."""
        if not _valid_branch_name(self.main_root, branch):
            raise worktree.WorktreeError(f"{branch!r} is not a valid branch name")
        existing = main_branch.list_branches(self.main_root)
        if branch in existing:
            raise worktree.WorktreeError(f"branch {branch!r} already exists")
        # Only a local branch: a client-sent "--orphan" would otherwise be parsed as a git flag.
        if start_point is not None and start_point not in existing:
            raise main_branch.UnknownBranchError(start_point)
        base = start_point or main_branch.current_branch(self.main_root)
        return self._provision(branch, create=True, start_point=base)

    def _provision(self, branch: str, create: bool, start_point: str | None) -> BranchRecord:
        with self._lock:
            workspace_id = self._unique_id(branch)
            path = worktree.worktree_path(self.main_root, workspace_id)
            # Before `add`: an unexcluded nested worktree reads to GitSync as thousands of files.
            ensure_excluded(self.main_root, skill_sync.WORKTREE_EXCLUDES)
            if create:
                worktree.add(self.main_root, branch, path, start_point=start_point)
            else:
                worktree.attach(self.main_root, branch, path)
            try:
                self._prepare(path)
            except Exception:
                # Never leave a checkout (and a branch we just made) that no record points at.
                self._undo_provision(branch, path, create)
                raise
            record = BranchRecord(
                id=workspace_id,
                branch=branch,
                worktree=str(path),
                created_at=_now(),
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

    def _undo_provision(self, branch: str, path: Path, created: bool) -> None:
        try:
            worktree.remove(self.main_root, path, force=True)
            if created:
                worktree.delete_branch(self.main_root, branch)
        except worktree.WorktreeError:
            logger.exception("branches: could not clean up the half-made worktree %s", path)

    def delete(
        self, workspace_id: str, remove_worktree: bool = False, force: bool = False
    ) -> BranchRecord:
        """Forgets the record; the directory goes only on request, and the branch never does."""
        with self._lock:
            record = self.get(workspace_id)
            if remove_worktree:
                worktree.remove(self.main_root, Path(record.worktree), force=force)
            self._records.pop(workspace_id, None)
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


def _now() -> str:
    return utc_now_iso()


def _valid_branch_name(root: Path, branch: str) -> bool:
    """Git's own verdict on a branch name, so we never reimplement `check-ref-format`."""
    if not branch.strip() or branch.startswith("-"):
        return False
    result = run_git_raw(root, "check-ref-format", "--branch", branch)
    return result is not None and result.returncode == 0
