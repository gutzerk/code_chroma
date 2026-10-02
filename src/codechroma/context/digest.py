"""Builds a token-efficient project digest from data GraphEngine already computed and persisted.

An AI assistant generating a C1 (system-context) diagram reads this instead of re-grepping the
repo or re-reading raw source: candidate external integrations, derived from the already-analyzed
in-memory graph plus a couple of cheap file reads (README, dependency manifests). C1 only draws one
system box plus outside actors, so this stays scoped to "what does it integrate with" -- no
per-subsystem breakdown or internal dependency counts, since no C1 consumer reads those.
"""

from __future__ import annotations

import re
import tomllib
from collections import Counter
from pathlib import Path

from codechroma.config import settings
from codechroma.engine import ROOT_SENTINEL, GraphEngine
from codechroma.graph.models import DIRECTORY_LEVELS, HierarchyNode
from codechroma.io import load_json, read_text

_GO_VERSION_SUFFIX = re.compile(r"/v\d+$")
_GO_REQUIRE_BLOCK_START = re.compile(r"^require\s*\($")
_GO_REQUIRE_SINGLE_LINE = re.compile(r"^require\s+(\S+)")

# Excluded so common stdlib noise doesn't dominate the digest — not exhaustive, just cheap trimming.
_STDLIB_DENYLIST = {
    "os", "sys", "re", "io", "json", "typing", "pathlib", "collections", "dataclasses",
    "functools", "itertools", "logging", "subprocess", "shutil", "threading", "asyncio",
    "contextlib", "hashlib", "uuid", "datetime", "argparse", "socket", "signal", "time",
    "abc", "enum", "copy", "math", "random", "string", "textwrap", "traceback", "warnings",
    "unittest", "importlib", "inspect", "tempfile", "glob", "csv",
}


def build_context_digest(engine: GraphEngine, repo_root: Path) -> dict:
    """A compact dict summarizing the analyzed repo, for a single AI-assistant call to read."""
    known_names = {n.name for n in _all_nodes(engine) if n.level in DIRECTORY_LEVELS}

    return {
        "repo_name": repo_root.resolve().name,
        "external_import_roots": _external_import_roots(engine, known_names),
        "declared_dependencies": _declared_dependencies(repo_root),
        "readme_excerpt": _readme_excerpt(repo_root),
    }


def _all_nodes(engine: GraphEngine) -> list[HierarchyNode]:
    """Every node in the current graph, walked breadth-first from the root via the public API."""
    seen: dict[str, HierarchyNode] = {}
    queue: list[HierarchyNode] = list(engine.get_children(ROOT_SENTINEL))
    while queue:
        node = queue.pop()
        if node.id in seen:
            continue
        seen[node.id] = node
        queue.extend(engine.get_children(node.id))
    return list(seen.values())


def _external_import_roots(engine: GraphEngine, known_names: set[str]) -> list[dict]:
    roots: Counter[str] = Counter()
    for symbol in engine.iter_symbols():
        for dotted in symbol.imports.values():
            root = dotted.split(".", 1)[0]
            if root and root not in known_names and root not in _STDLIB_DENYLIST:
                roots[root] += 1
    return [
        {"root": root, "count": count}
        for root, count in sorted(roots.items(), key=lambda kv: -kv[1])
    ]


def _declared_dependencies(repo_root: Path) -> list[str]:
    names: list[str] = []
    pyproject = repo_root / "pyproject.toml"
    if pyproject.is_file():
        try:
            data = tomllib.loads(pyproject.read_text())
        except (OSError, tomllib.TOMLDecodeError):
            data = {}
        for dep in data.get("project", {}).get("dependencies", []):
            if isinstance(dep, str):
                names.append(_dependency_name(dep))

    package_json = repo_root / "package.json"
    if package_json.is_file():
        names.extend(load_json(package_json).get("dependencies", {}).keys())

    names.extend(_go_mod_dependencies(repo_root))

    return names


def _go_mod_dependencies(repo_root: Path) -> list[str]:
    """Module paths from go.mod's `require` directives -- go.mod isn't TOML/JSON, parsed by line."""
    go_mod = repo_root / "go.mod"
    text = read_text(go_mod)
    if text is None:
        return []

    names: list[str] = []
    in_require_block = False
    for line in text.splitlines():
        stripped = line.split("//", 1)[0].strip()
        if not stripped:
            continue
        if in_require_block:
            if stripped == ")":
                in_require_block = False
                continue
            names.append(_go_module_name(stripped.split()[0]))
        elif _GO_REQUIRE_BLOCK_START.match(stripped):
            in_require_block = True
        elif single_line := _GO_REQUIRE_SINGLE_LINE.match(stripped):
            names.append(_go_module_name(single_line.group(1)))
    return names


def _go_module_name(module_path: str) -> str:
    """Strips Go's major-version-suffix path segment, e.g. ".../go-redis/v9" -> ".../go-redis"."""
    return _GO_VERSION_SUFFIX.sub("", module_path)


def _dependency_name(requirement: str) -> str:
    """The bare package name from a requirement string, e.g. "fastapi (>=0.1)" -> "fastapi"."""
    for sep in (" ", "(", ">", "<", "=", "!", "~", "[", ";"):
        if sep in requirement:
            requirement = requirement.split(sep, 1)[0]
    return requirement.strip()


def _readme_excerpt(repo_root: Path) -> str | None:
    for name in ("README.md", "readme.md", "README.rst", "README.txt"):
        text = read_text(repo_root / name)
        if text is not None:
            return text[:settings.context_digest.readme_excerpt_chars]
    return None
