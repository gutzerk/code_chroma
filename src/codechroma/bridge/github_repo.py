"""Opening a GitHub project by URL or `owner/repo`: clone it into a managed cache, or refresh it.

The cache lives under `~/.codechroma/github-repos/<owner>/<repo>` (`$CODECHROMA_GITHUB_CACHE_DIR`
moves it, `--clone-dir` overrides it per launch). A repo already cloned there is fetched, not
re-cloned, so re-opening is fast. The checkout is always **detached** at the requested branch /
tag / commit (default: the remote's default branch), so a refresh never merges into a local branch.

🔴 Private repos use whatever git credentials the user already has (credential helper, ssh agent,
`gh auth setup-git`); `git_long.non_interactive_env()` turns a credential prompt into an immediate
failure, which `_explain` renders as "authentication required". No token is put in a URL or argv.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

from codechroma.bridge.git_cmd import run_git
from codechroma.bridge.git_long import (
    REASON_NOT_RUNNABLE,
    REASON_TIMED_OUT,
    TIMEOUT_ENV_VAR,
    GitLongError,
    run_git_long,
)
from codechroma.errors import codechromaError

CACHE_ENV_VAR = "CODECHROMA_GITHUB_CACHE_DIR"

_NAME = r"[A-Za-z0-9][A-Za-z0-9._-]*"
_REPO = r"[A-Za-z0-9][A-Za-z0-9._-]*?"
_URL = re.compile(
    rf"^(?:(?:https?://|ssh://git@)?(?:www\.)?github\.com[/:]|git@github\.com:)"
    rf"(?P<owner>{_NAME})/(?P<repo>{_REPO})(?:\.git)?"
    rf"(?:/(?:tree|commit)/(?P<ref>.+?))?/?$"
)
_SHORTHAND = re.compile(rf"^(?P<owner>{_NAME})/(?P<repo>{_REPO})(?:\.git)?$")


class GithubRepoError(codechromaError):
    """A GitHub project could not be opened; the message says why in the user's terms."""


@dataclass(slots=True, frozen=True)
class GithubRef:
    """A GitHub repository the user named, with the optional branch / tag / commit to check out."""

    owner: str
    repo: str
    ref: str | None = None

    @property
    def slug(self) -> str:
        return f"{self.owner}/{self.repo}"


def parse_github_ref(raw: object, ref: str | None = None) -> GithubRef:
    """A URL, ssh form, `o/r` or `o/r@ref`; an explicit `ref` wins over an inline one."""
    text = raw.strip() if isinstance(raw, str) else ""
    inline_ref: str | None = None
    match = _URL.match(text)
    if match:
        inline_ref = match.group("ref")
    else:
        shorthand, _, suffix = text.partition("@")
        match = _SHORTHAND.match(shorthand)
        inline_ref = suffix or None
    if match is None or match.group("repo") in (".", "..") or not match.group("repo"):
        raise GithubRepoError(
            "Paste a GitHub URL (https://github.com/owner/repo) or owner/repo, "
            "optionally owner/repo@branch"
        )
    chosen = (ref or "").strip() or inline_ref
    if chosen and chosen.startswith("-"):
        raise GithubRepoError(f"'{chosen}' is not a valid branch, tag or commit")
    return GithubRef(match.group("owner"), match.group("repo"), chosen or None)


def cache_root() -> Path:
    override = os.environ.get(CACHE_ENV_VAR, "").strip()
    return Path(override).expanduser() if override else Path.home() / ".codechroma" / "github-repos"


def clone_url(reference: GithubRef) -> str:
    return f"https://github.com/{reference.slug}.git"


def open_github_repo(
    reference: GithubRef, clone_dir: Path | None = None, *, refresh: bool = True
) -> Path:
    """Clones (or fetches) the repo, checks out the requested ref detached, returns its path."""
    dest = (clone_dir or cache_root() / reference.owner / reference.repo).expanduser().resolve()
    try:
        if (dest / ".git").exists():
            if refresh:
                run_git_long(dest, "fetch", "--tags", "--prune", "origin")
        elif dest.exists() and any(dest.iterdir()):
            raise GithubRepoError(f"{dest} exists and is not a git checkout; choose another dir")
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            run_git_long(dest.parent, "clone", clone_url(reference), str(dest))
        _check_out(dest, reference)
    except GitLongError as exc:
        raise GithubRepoError(_explain(exc, reference)) from exc
    return dest


def _resolve(dest: Path, reference: GithubRef) -> str | None:
    """The commit for the requested branch / tag / sha, or the remote default; None if unknown."""
    candidates = (
        [f"origin/{reference.ref}", f"refs/tags/{reference.ref}", reference.ref]
        if reference.ref
        else ["origin/HEAD", "HEAD"]
    )
    for candidate in candidates:
        sha = run_git(dest, "rev-parse", "--verify", "--quiet", f"{candidate}^{{commit}}")
        if sha:
            return sha.strip()
    return None


def _check_out(dest: Path, reference: GithubRef) -> None:
    sha = _resolve(dest, reference)
    if sha is None:
        raise GithubRepoError(
            f"{reference.slug} has no branch, tag or commit named '{reference.ref}'"
            if reference.ref
            else f"{reference.slug} has no commits to open"
        )
    run_git_long(dest, "checkout", "--detach", "--quiet", sha)


def _explain(exc: GitLongError, reference: GithubRef) -> str:
    """git's own failure rendered as the four things a user can act on."""
    if exc.reason == REASON_NOT_RUNNABLE:
        return "git is not installed or not on PATH; install git to open GitHub projects"
    if exc.reason == REASON_TIMED_OUT:
        return (
            f"Timed out talking to GitHub for {reference.slug}; check your network "
            f"or raise {TIMEOUT_ENV_VAR}"
        )
    detail = str(exc).lower()
    if "not found" in detail or "does not exist" in detail:
        return (
            f"Repository {reference.slug} was not found, or you have no access to it "
            "(private repos need git credentials, e.g. `gh auth setup-git`)"
        )
    if any(hint in detail for hint in ("could not read", "authentication failed", "permission")):
        return (
            f"Authentication is required to open {reference.slug}; "
            "set up git credentials (e.g. `gh auth login && gh auth setup-git`) and retry"
        )
    if any(hint in detail for hint in ("resolve host", "unable to access", "network")):
        return f"Could not reach GitHub to open {reference.slug}: check your network ({exc})"
    return f"Could not open {reference.slug}: {exc}"
