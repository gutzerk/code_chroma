"""Reading a pull request's identity from what the user pasted, and its metadata from `gh`."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from codechroma.bridge.agents.publish import run_gh
from codechroma.llm.runtime_env import cli_available

logger = logging.getLogger("uvicorn.error")

# github.com/<owner>/<repo>[.git]/pull/<n>, in https, ssh and browser-with-suffix forms.
_PR_URL = re.compile(
    r"github\.com[/:](?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?/pull/(?P<number>\d+)"
)

_BARE_NUMBER = re.compile(r"^#?(?P<number>\d+)$")

_METADATA_FIELDS = (
    "number,title,url,state,author,headRefName,headRefOid,baseRefName,"
    "isCrossRepository,headRepositoryOwner,additions,deletions,changedFiles"
)


@dataclass(slots=True)
class PrReference:
    """A pull request the user named; owner/repo are None when they only gave a number."""

    number: int
    owner: str | None = None
    repo: str | None = None


def parse_pr_reference(raw: object) -> PrReference | None:
    """The pull request `raw` names, or None when it names none — a URL, `#123` or `123`."""
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None
    match = _PR_URL.search(text)
    if match:
        return PrReference(
            number=int(match.group("number")),
            owner=match.group("owner"),
            repo=match.group("repo"),
        )
    bare = _BARE_NUMBER.match(text)
    return PrReference(number=int(bare.group("number"))) if bare else None


def repository_slug(repo_root: Path) -> tuple[str, str] | None:
    """The current checkout's GitHub owner/repo as resolved by `gh`, or None if unresolved."""
    raw = run_gh(repo_root, "repo", "view", "--json", "nameWithOwner")
    if raw is None:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        logger.warning("prs: gh repo view returned unparseable JSON")
        return None
    slug = data.get("nameWithOwner") if isinstance(data, dict) else None
    if not isinstance(slug, str):
        return None
    owner, separator, repo = slug.strip().partition("/")
    if not separator or not owner or not repo or "/" in repo:
        return None
    return owner, repo


def belongs_to_repository(reference: PrReference, repo_root: Path) -> bool:
    """Whether this reference belongs to the repository resolved from the current checkout."""
    # A bare number can only mean "in this repo", so there is nothing to disagree with.
    if reference.owner is None or reference.repo is None:
        return True
    slug = repository_slug(repo_root)
    if slug is None:
        return False
    return (reference.owner.lower(), reference.repo.lower()) == (
        slug[0].lower(),
        slug[1].lower(),
    )


def is_github_repository(repo_root: Path) -> bool:
    """Whether `gh` can resolve the current checkout to a GitHub repository."""
    return repository_slug(repo_root) is not None


def has_gh() -> bool:
    return cli_available("gh")


def is_authenticated(repo_root: Path) -> bool:
    return run_gh(repo_root, "auth", "status") is not None


def list_open_prs(repo_root: Path) -> list[dict] | None:
    """`gh pr list --json …` parsed into `{number, title, head_ref, author}`; None if gh failed."""
    raw = run_gh(repo_root, "pr", "list", "--json", "number,title,headRefName,author")
    if raw is None:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        logger.warning("prs: gh pr list returned unparseable JSON")
        return None
    if not isinstance(data, list):
        return None
    return [
        {
            "number": item["number"],
            "title": str(item.get("title") or f"#{item['number']}"),
            "head_ref": str(item.get("headRefName") or ""),
            "author": author_login(item),
        }
        for item in data
        if isinstance(item, dict) and isinstance(item.get("number"), int)
    ]


def fetch_metadata(repo_root: Path, number: int) -> dict | None:
    """`gh pr view <n> --json …` parsed, or None when gh failed or the PR doesn't exist."""
    raw = run_gh(repo_root, "pr", "view", str(number), "--json", _METADATA_FIELDS)
    if raw is None:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        logger.warning("prs: gh pr view %s returned unparseable JSON", number)
        return None
    return data if isinstance(data, dict) and data.get("headRefOid") else None


def head_owner(metadata: dict) -> str:
    """`owner/repo` the head branch lives in, which is a fork for a cross-repository PR."""
    owner = metadata.get("headRepositoryOwner")
    login = owner.get("login") if isinstance(owner, dict) else owner
    return str(login) if login else ""


def author_login(metadata: dict) -> str:
    author = metadata.get("author")
    login = author.get("login") if isinstance(author, dict) else author
    return str(login) if login else ""


def fetch_general_comments(repo_root: Path, number: int) -> list[dict]:
    """Issue-level PR discussion (not tied to a file/line), via `gh pr view --json comments`."""
    raw = run_gh(repo_root, "pr", "view", str(number), "--json", "comments")
    if raw is None:
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        logger.warning("prs: gh pr view %s --json comments returned unparseable JSON", number)
        return []
    comments = data.get("comments") if isinstance(data, dict) else None
    if not isinstance(comments, list):
        return []
    return [_normalize_comment(comment) for comment in comments if isinstance(comment, dict)]


def fetch_review_comments(repo_root: Path, number: int) -> list[dict]:
    """Inline comments on a diff line, via the REST `pulls/{n}/comments` endpoint."""
    slug = repository_slug(repo_root)
    if slug is None:
        return []
    owner, repo = slug
    raw = run_gh(repo_root, "api", f"repos/{owner}/{repo}/pulls/{number}/comments", "--paginate")
    if raw is None:
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        logger.warning("prs: gh api pulls/%s/comments returned unparseable JSON", number)
        return []
    if not isinstance(data, list):
        return []
    return [_normalize_comment(comment) for comment in data if isinstance(comment, dict)]


def _normalize_comment(raw: dict) -> dict:
    """One comment as {author, body, created_at, path, line}, whichever `gh` shape it came from."""
    author_field = raw.get("author") if isinstance(raw.get("author"), dict) else raw.get("user")
    login = author_field.get("login") if isinstance(author_field, dict) else None
    body = raw.get("body")
    created = raw.get("createdAt") or raw.get("created_at")
    path = raw.get("path")
    line = _as_line(raw.get("line"))
    if line is None:
        line = _as_line(raw.get("original_line"))
    return {
        "author": str(login) if login else "",
        "body": str(body) if isinstance(body, str) else "",
        "created_at": str(created) if isinstance(created, str) else "",
        "path": path.strip("/") if isinstance(path, str) and path else None,
        "line": line,
    }


def _as_line(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None
