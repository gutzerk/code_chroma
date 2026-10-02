"""The pull-request registry: `<main_root>/.codechroma/prs.json`, and the cap on open reviews.

A sibling of agents.json rather than more rows in it. Three reasons, worst first.
`AgentRecord.from_json` requires title+branch+worktree and drops unknown keys, so an older bridge
reading a shared file would keep a `kind: "pr"` row and silently discard its ten PR fields — a
broken agent card with a Start button. Every consumer of `AgentManager.list()` assumes a startable
agent (the session registry, the PR-publish preflight, one window and one LED per
record), so sharing means an `if kind == "pr": continue` at eight sites. And MAX_AGENTS is
subscription spend while a PR is only memory, so the two caps need different messages.

What that split does *not* cost is most of reconciliation: a PR needs none of the id-renaming,
legacy-path migration or pid clearing agents do -- just the `worktree_lost` flag, plus the same
canvas.json backfill agents.reconcile() already does for a worktree seeded before that existed.
🔴 That backfill calls `pr_import_seed.seed_canvas_doc` and nothing wider. The full
`seed_diagrams_from_main` belongs to *import* only: its `_copy_requirements_source` step is a
`copytree(dirs_exist_ok=True)`, i.e. an overwrite, so re-running it every boot would restore main's
requirements/epics files over whatever the PR itself changed.

🔴 No `base_sha`, and no stored ref names: like agents.json's missing `base_commit`, they are
derived on demand. `head_sha` *is* stored — it answers "has this PR moved since we fetched it?".
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path

from codechroma.bridge.pr_import_seed import seed_canvas_doc
from codechroma.bridge.workspaces import PR_ID_PREFIX
from codechroma.config import settings
from codechroma.errors import codechromaError
from codechroma.io import load_json, write_json

logger = logging.getLogger("uvicorn.error")

# Each open review is a full GraphEngine in memory; the same argument as MAX_AGENTS, smaller number.
REGISTRY_VERSION = 1


def max_pr_workspaces() -> int:
    return settings.pr_workspaces.max_pr_workspaces

_PERSISTED_FIELDS = (
    "number", "title", "url", "author", "state", "head_ref", "head_sha", "head_repo", "is_fork",
    "base_ref", "worktree", "imported_at", "fetched_at", "changed_files", "additions", "deletions",
    "review_comments", "general_comments",
)


class PrLimitError(codechromaError):
    """The cap on open pull-request reviews is reached; the route turns this into a 409."""


class UnknownPrError(codechromaError, KeyError):
    """No pull request with that number is open."""


@dataclass
class PrRecord:
    """One fetched pull request: its identity, its worktree, and what it compares against."""

    number: int
    title: str
    url: str
    head_ref: str
    head_sha: str
    base_ref: str
    worktree: str
    imported_at: str
    fetched_at: str
    author: str = ""
    state: str = ""
    head_repo: str = ""
    is_fork: bool = False
    changed_files: int = 0
    additions: int = 0
    deletions: int = 0
    # Inline (path/line-tied) and issue-level PR comments, fetched alongside metadata.
    review_comments: list[dict] = field(default_factory=list)
    general_comments: list[dict] = field(default_factory=list)
    # Runtime only, recomputed at startup: the directory was deleted by hand or by `git clean`.
    worktree_lost: bool = field(default=False, compare=False)

    @property
    def id(self) -> str:
        """The workspace id the canvas addresses this pull request by."""
        return f"{PR_ID_PREFIX}{self.number}"

    def to_json(self) -> dict:
        """Only the persisted fields — runtime state must never be read back as truth."""
        data = asdict(self)
        return {key: data[key] for key in _PERSISTED_FIELDS}

    def to_payload(self) -> dict:
        """Everything the canvas needs, including the derived id and the runtime flags."""
        return {**asdict(self), "id": self.id}

    @classmethod
    def from_json(cls, raw: object) -> PrRecord | None:
        """One record from disk, or None when it can't be trusted; unknown keys are dropped."""
        if not isinstance(raw, dict):
            return None
        number = raw.get("number")
        worktree = raw.get("worktree")
        if not isinstance(number, int) or isinstance(number, bool) or number <= 0:
            return None
        if not isinstance(worktree, str) or not worktree:
            return None
        return cls(
            number=number,
            title=_text(raw.get("title")),
            url=_text(raw.get("url")),
            head_ref=_text(raw.get("head_ref")),
            head_sha=_text(raw.get("head_sha")),
            base_ref=_text(raw.get("base_ref")),
            worktree=worktree,
            imported_at=_text(raw.get("imported_at")),
            fetched_at=_text(raw.get("fetched_at")),
            author=_text(raw.get("author")),
            state=_text(raw.get("state")),
            head_repo=_text(raw.get("head_repo")),
            is_fork=bool(raw.get("is_fork")),
            changed_files=_count(raw.get("changed_files")),
            additions=_count(raw.get("additions")),
            deletions=_count(raw.get("deletions")),
            review_comments=_comments(raw.get("review_comments")),
            general_comments=_comments(raw.get("general_comments")),
        )


def _text(value: object) -> str:
    return value if isinstance(value, str) else ""


def _count(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _comments(value: object) -> list[dict]:
    """A stored comment list, tolerating a missing or malformed field like every other one here."""
    return [entry for entry in value if isinstance(entry, dict)] if isinstance(value, list) else []


class PrManager:
    """Owns prs.json and the cap; the fetching and the worktree itself live in prs.importer."""

    def __init__(self, main_root: Path) -> None:
        self.main_root = main_root.resolve()
        self._prs: dict[int, PrRecord] = {}
        self._load()

    @property
    def registry_path(self) -> Path:
        """In the *main* repository: the list spans every worktree, so it can't live in one."""
        return self.main_root / ".codechroma" / "prs.json"

    def _load(self) -> None:
        """Reads prs.json, tolerating a missing or malformed file as the rest of the bridge does."""
        raw = load_json(self.registry_path)
        entries = raw.get("prs") if isinstance(raw, dict) else None
        if not isinstance(entries, list):
            return
        for entry in entries:
            record = PrRecord.from_json(entry)
            if record is not None:
                self._prs[record.number] = record

    def save(self) -> None:
        """Atomic temp+rename — a half-written registry would lose every open review."""
        payload = {
            "version": REGISTRY_VERSION,
            "prs": [record.to_json() for record in self._prs.values()],
        }
        write_json(self.registry_path, payload)

    def list(self) -> list[PrRecord]:
        return list(self._prs.values())

    def find(self, number: int) -> PrRecord | None:
        return self._prs.get(number)

    def find_by_id(self, workspace_id: str) -> PrRecord | None:
        """The PR `workspace_id` (e.g. `pr-282`) names, or None if it isn't one we hold."""
        if not workspace_id.startswith(PR_ID_PREFIX):
            return None
        try:
            number = int(workspace_id.removeprefix(PR_ID_PREFIX))
        except ValueError:
            return None
        return self.find(number)

    def get(self, number: int) -> PrRecord:
        record = self._prs.get(number)
        if record is None:
            raise UnknownPrError(number)
        return record

    def at_capacity(self) -> bool:
        return len(self._prs) >= max_pr_workspaces()

    def upsert(self, record: PrRecord) -> PrRecord:
        """Records a fetched pull request; the cap only applies to one that isn't open already."""
        if record.number not in self._prs and self.at_capacity():
            raise PrLimitError(record.number)
        self._prs[record.number] = record
        self.save()
        return record

    def delete(self, number: int) -> PrRecord:
        record = self.get(number)
        self._prs.pop(number, None)
        self.save()
        return record

    def reconcile(self) -> None:
        """Flags a review whose worktree vanished rather than dropping its card silently."""
        for record in self._prs.values():
            record.worktree_lost = not Path(record.worktree).is_dir()
            if record.worktree_lost:
                logger.warning("prs: worktree missing for %s at %s", record.id, record.worktree)
            else:
                # 🔴 Not the whole seed: its copytree would overwrite the PR's requirements source.
                try:
                    seed_canvas_doc(Path(record.worktree), self.main_root)
                except OSError:
                    logger.exception("prs: could not seed canvas.json into %s", record.worktree)
