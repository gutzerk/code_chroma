"""Handing an agent's work off: `git push` plus `gh pr create`, with every blocker checked first.

The button on the card is disabled **with its reason as the label** rather than producing a generic
error after the click, so every check here runs before the UI renders anything.

🔴 Uncommitted edits in the worktree are a separate case, not a blocker: `push` would not pick them
up and the PR would come out incomplete, which the user only discovers on GitHub. Preflight returns
the file list and the UI requires an explicit choice — commit them, or publish without them.

There is deliberately no local merge into the main branch. That would be the first time this app
wrote into the user's working copy: it needs dirty-tree locking, conflict handling and rollback.
Merging is delegated to GitHub via the PR, or done by hand.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

from codechroma.bridge.git_cmd import porcelain_paths, run_git, run_git_raw
from codechroma.bridge.git_long import GitLongError, kill_process_group, run_git_long
from codechroma.config import settings
from codechroma.errors import codechromaError

logger = logging.getLogger("uvicorn.error")

REASON_GH_MISSING = "gh-missing"
REASON_NOT_AUTHENTICATED = "not-authenticated"
REASON_NOT_GITHUB = "not-github"
REASON_NO_COMMITS = "no-commits"
REASON_EXISTS = "pr-exists"
REASON_PR_ATTACHED = "pr-attached"

# What the disabled button says for each blocker; the UI shows this verbatim.
BUTTON_TEXT = {
    REASON_GH_MISSING: "GitHub CLI required",
    REASON_NOT_AUTHENTICATED: "Log in: gh auth login",
    REASON_NOT_GITHUB: "Could not detect a GitHub repository; check that `gh repo view` works here",
    REASON_NO_COMMITS: "The agent hasn't committed anything yet",
    REASON_PR_ATTACHED: "Reviewing a PR -- can't publish from here",
}

def _gh_timeout() -> int:
    return settings.publish.gh_timeout_seconds


def _commit_message_model() -> str:
    return settings.publish.commit_message_model


def _commit_message_timeout() -> int:
    return settings.publish.commit_message_timeout_seconds


def _max_commit_message_attempts() -> int:
    return settings.publish.max_commit_message_attempts


def _diff_char_limit() -> int:
    return settings.publish.diff_char_limit


_FALLBACK_COMMIT_MESSAGE = "chore: agent work in progress"


class PublishError(codechromaError):
    """Creating the PR failed; the message is git's or gh's own, shown to the user verbatim."""


def preflight(worktree: Path, branch: str, main_branch: str, source_pr: str | None = None) -> dict:
    """Everything that would stop a PR, checked before the button renders — not after a click."""
    if source_pr is not None:
        return _blocked(REASON_PR_ATTACHED)
    if shutil.which("gh") is None:
        return _blocked(REASON_GH_MISSING)
    if run_gh(worktree, "auth", "status") is None:
        return _blocked(REASON_NOT_AUTHENTICATED)

    # Local import: prs/github.py imports run_gh from here, so a top-level import would be circular.
    from codechroma.bridge.prs.github import is_github_repository

    remote = run_git(worktree, "remote", "get-url", "origin")
    if remote is None or not is_github_repository(worktree):
        return _blocked(REASON_NOT_GITHUB, remote=remote.strip() if remote else None)

    existing = existing_pr_url(worktree, branch)
    if existing:
        return {"ready": False, "reason": REASON_EXISTS, "pr_url": existing, "dirty": []}

    if not _commits_ahead(worktree, branch, main_branch):
        return _blocked(REASON_NO_COMMITS)

    return {"ready": True, "reason": None, "pr_url": None, "dirty": dirty_files(worktree)}


def dirty_files(worktree: Path) -> list[str]:
    """Uncommitted paths a push would leave behind — the UI must not let these go unnoticed."""
    raw = run_git(worktree, "status", "--porcelain", "--untracked-files=all")
    return sorted(porcelain_paths(raw or ""))


def existing_pr_url(worktree: Path, branch: str) -> str | None:
    """The PR already open for this branch, so a second click links to it, not duplicates it."""
    result = run_gh(worktree, "pr", "view", branch, "--json", "url", "--jq", ".url")
    if result is None:
        return None
    url = result.strip()
    return url if url.startswith("http") else None


def create_pr(
    worktree: Path, branch: str, main_branch: str, commit_dirty: bool = False,
    source_pr: str | None = None,
) -> str:
    """Optionally commits the tree, pushes the branch, opens the PR; returns its URL."""
    if source_pr is not None:
        raise PublishError(f"agent is attached to {source_pr}'s own branch -- cannot publish here")
    dirty = dirty_files(worktree)
    if dirty and commit_dirty:
        if run_git(worktree, "add", "-A") is None:
            raise PublishError("git add -A failed in the agent's worktree")
        error: str | None = None
        commit = None
        for _attempt in range(_max_commit_message_attempts()):
            message = _generate_commit_message(worktree, error)
            commit = run_git_raw(worktree, "commit", "-m", message)
            if commit is not None and commit.returncode == 0:
                break
            error = _message_of(commit, "git commit failed")
        else:
            raise PublishError(error or "git commit failed")

    # run_git_long: a real push outlives git_cmd's 10s cap, and a credential prompt would wedge it.
    try:
        run_git_long(worktree, "push", "-u", "origin", branch)
    except GitLongError as exc:
        raise PublishError(str(exc)) from exc

    existing = existing_pr_url(worktree, branch)
    if existing:
        return existing

    created = run_gh(worktree, "pr", "create", "--fill", "--head", branch, "--base", main_branch)
    if created is None:
        raise PublishError("gh pr create failed")
    url = _first_url(created)
    if url is None:
        raise PublishError("gh pr create returned no URL")
    return url


def _generate_commit_message(worktree: Path, previous_error: str | None = None) -> str:
    """Asks Claude for a message fitting the staged diff; a rejection is fed back for one retry."""
    if shutil.which("claude") is None:
        return _FALLBACK_COMMIT_MESSAGE
    diff = run_git(worktree, "diff", "--cached") or ""
    if len(diff) > _diff_char_limit():
        diff = diff[:_diff_char_limit()] + "\n... (truncated)"
    feedback = (
        f"\n\nYour previous message was rejected by this repo's commit-msg hook: "
        f"{previous_error}\nWrite a different message that would pass it.\n"
        if previous_error
        else ""
    )
    prompt = (
        "Write a single-line commit message for the following staged diff, following Conventional "
        "Commits (type(scope): summary) unless the diff itself reveals a different convention this "
        "repo uses. Output ONLY the commit message text, nothing else — no quotes, no explanation."
        f"{feedback}\n\n{diff}"
    )
    try:
        result = subprocess.run(
            ["claude", "-p", prompt, "--model", _commit_message_model()],
            cwd=worktree,
            capture_output=True,
            text=True,
            timeout=_commit_message_timeout(),
        )
    except (OSError, subprocess.TimeoutExpired):
        return _FALLBACK_COMMIT_MESSAGE
    if result.returncode != 0:
        return _FALLBACK_COMMIT_MESSAGE
    lines = [line.strip().strip('"') for line in result.stdout.strip().splitlines() if line.strip()]
    return lines[0] if lines else _FALLBACK_COMMIT_MESSAGE


def _blocked(reason: str, **extra: object) -> dict:
    return {"ready": False, "reason": reason, "text": BUTTON_TEXT.get(reason), "dirty": [], **extra}


def _commits_ahead(worktree: Path, branch: str, main_branch: str) -> bool:
    """Whether the branch is ahead of the base; no commits means nothing to open a PR for."""
    raw = run_git(worktree, "rev-list", "--count", f"{main_branch}..{branch}")
    try:
        return int((raw or "0").strip()) > 0
    except ValueError:
        return False


def run_gh(worktree: Path, *args: str) -> str | None:
    """`gh` in a checkout (public: the PR importer reuses it); None when it fails or hangs."""
    # Own process group: killing gh alone orphans its credential helper, pager and ssh.
    try:
        process = subprocess.Popen(
            ["gh", *args],
            cwd=worktree,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=not settings.windows,
        )
    except OSError:
        return None
    try:
        timeout = _gh_timeout()
        stdout, _stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        kill_process_group(process)
        logger.warning("publish: gh %s timed out after %ss", " ".join(args), timeout)
        return None
    return stdout if process.returncode == 0 else None


def _first_url(output: str) -> str | None:
    for line in output.splitlines():
        candidate = line.strip()
        if candidate.startswith("http"):
            return candidate
    return None


def _message_of(result: subprocess.CompletedProcess[str] | None, fallback: str) -> str:
    if result is None:
        return fallback
    return (result.stderr or result.stdout or "").strip() or fallback
