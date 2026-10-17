# ruff: noqa: E501
"""Loader and matchers for the language-neutral bridge wire contract in tests/fixtures/bridge_contract.

The same JSON case files are replayed by `test_bridge_wire_contract.py` against the Python FastAPI
bridge (the reference) and by `dotnet/CodeChroma.Bridge.Tests` against the ASP.NET Core bridge. Any
change to the matcher semantics below must be mirrored in `ContractMatchers.cs`.

Case file: {"group", "sources", "repo": {"base", "files"}, "cases": [{"id", "requires", "matrix",
"repo", "steps"}]}. A step is one of:
  {"http": {"method", "path", "query", "headers", "json"}, "expect": {"status", "json", "checks"}}
  {"fs": "write" | "delete" | "replace", "path", "text" | "base64" | "find" + "with"}
  {"ws": "connect", "name", "path", "headers", "expect": "accepted" | "rejected"}
  {"ws": "receive", "name", "timeout_ms", "skip_until_match", "tag", "raw", "expect": {...}}
  {"ws": "expect_close", "name", "code"}
`expect.json` is an exact deep compare in which {"$any": true} matches anything; a string containing
"$REPO" is the workspace root. `checks` entries are {"path", "equals" | "contains" | "count" |
"absent" | "type"} over a tiny JSONPath: $ .key ['key'] ..key [*] [key=value] [index]. `matrix` expands a case once
per entry, replacing "${name}" in every string. `requires` lists capabilities a backend may lack.
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

CONTRACT_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "bridge_contract"
MISSING = object()

_TOKEN = re.compile(r"\.\.(\w+)|\.(\w+)|\['([^']+)'\]|\[\*\]|\[(\w+)=([^\]]*)\]|\[(\d+)\]")


def load_cases() -> list[dict]:
    """Every case from every `*.cases.json` file, matrices expanded, group/repo folded in."""
    cases: list[dict] = []
    for path in sorted(CONTRACT_DIR.glob("*.cases.json")):
        group = json.loads(path.read_text(encoding="utf-8"))
        for case in group["cases"]:
            for expanded in _expand(case):
                expanded["group"] = group["group"]
                expanded["repo"] = {
                    **group.get("repo", {"base": "sample_repo"}),
                    **expanded.get("repo", {}),
                }
                expanded["id"] = f"{group['group']}::{expanded['id']}"
                cases.append(expanded)
    return cases


def _expand(case: dict) -> list[dict]:
    matrix = case.get("matrix")
    if not matrix:
        return [case]
    name, values = next(iter(matrix.items()))
    expanded = []
    for value in values:
        clone = copy.deepcopy({key: val for key, val in case.items() if key != "matrix"})
        clone = _substitute(clone, name, str(value))
        clone["id"] = f"{case['id']}[{value}]"
        expanded.append(clone)
    return expanded


def _substitute(node: Any, name: str, value: str) -> Any:
    if isinstance(node, str):
        return node.replace("${" + name + "}", value)
    if isinstance(node, list):
        return [_substitute(item, name, value) for item in node]
    if isinstance(node, dict):
        return {
            _substitute(key, name, value): _substitute(val, name, value)
            for key, val in node.items()
        }
    return node


def _norm_path(text: str) -> str:
    return text.replace("\\", "/")


def json_matches(expected: Any, actual: Any, repo: str) -> bool:
    """Exact deep compare with `$any` wildcards and `$REPO` substitution (path-separator blind)."""
    if isinstance(expected, dict) and expected == {"$any": True}:
        return True
    if isinstance(expected, str):
        if "$REPO" in expected:
            expected = expected.replace("$REPO", repo)
            return (
                isinstance(actual, str)
                and _norm_path(expected).lower() == _norm_path(actual).lower()
            )
        return expected == actual
    if isinstance(expected, bool) or isinstance(actual, bool):
        return type(expected) is type(actual) and expected == actual
    if isinstance(expected, list):
        return (
            isinstance(actual, list)
            and len(expected) == len(actual)
            and all(json_matches(e, a, repo) for e, a in zip(expected, actual, strict=True))
        )
    if isinstance(expected, dict):
        return (
            isinstance(actual, dict)
            and set(expected) == set(actual)
            and all(json_matches(expected[key], actual[key], repo) for key in expected)
        )
    return expected == actual


def select(document: Any, path: str) -> tuple[list[Any], bool]:
    """Values the tiny JSONPath selects, plus whether it fanned out (wildcard/filter/descent)."""
    if not path.startswith("$"):
        raise ValueError(f"path must start with $: {path}")
    current: list[Any] = [document]
    fanned = False
    for match in _TOKEN.finditer(path[1:]):
        descent, dotted, quoted, filter_key, filter_value, index = match.groups()
        key = dotted or quoted
        step: list[Any] = []
        if descent:
            fanned = True
            for node in current:
                step.extend(_descend(node, descent))
        elif key:
            step = [node[key] for node in current if isinstance(node, dict) and key in node]
        elif filter_key:
            fanned = True
            for node in current:
                if isinstance(node, list):
                    step.extend(
                        item
                        for item in node
                        if isinstance(item, dict) and str(item.get(filter_key)) == filter_value
                    )
        elif index:
            step = [
                node[int(index)]
                for node in current
                if isinstance(node, list) and int(index) < len(node)
            ]
        else:
            fanned = True
            for node in current:
                if isinstance(node, list):
                    step.extend(node)
        current = step
    return current, fanned


def _descend(node: Any, key: str) -> list[Any]:
    found: list[Any] = []
    if isinstance(node, dict):
        if key in node:
            found.append(node[key])
        for value in node.values():
            found.extend(_descend(value, key))
    elif isinstance(node, list):
        for value in node:
            found.extend(_descend(value, key))
    return found


def check_failures(checks: list[dict], document: Any, repo: str) -> list[str]:
    """Human-readable failures for every check that does not hold on `document`."""
    failures = []
    for check in checks:
        values, fanned = select(document, check["path"])
        subject: Any = values if fanned else (values[0] if values else MISSING)
        if "absent" in check:
            absent = not values
            if absent != check["absent"]:
                failures.append(f"{check['path']}: absent={absent}, wanted {check['absent']}")
        elif subject is MISSING:
            failures.append(f"{check['path']}: missing")
        elif "equals" in check and not json_matches(check["equals"], subject, repo):
            failures.append(f"{check['path']}: {subject!r} != {check['equals']!r}")
        elif "contains" in check and not _contains(subject, check["contains"]):
            failures.append(f"{check['path']}: {subject!r} lacks {check['contains']!r}")
        elif "count" in check and len(subject) != check["count"]:
            failures.append(f"{check['path']}: count {len(subject)} != {check['count']}")
        elif "type" in check and json_type(subject) != check["type"]:
            failures.append(f"{check['path']}: type {json_type(subject)} != {check['type']}")
    return failures


def json_type(value: Any) -> str:
    """The JSON type name a `type` check compares against."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    return {str: "string", list: "array", dict: "object"}[type(value)]


def _contains(subject: Any, wanted: Any) -> bool:
    if isinstance(subject, str):
        return isinstance(wanted, str) and wanted in subject
    if isinstance(subject, list):
        return wanted in subject
    return False


def expectation_failures(expect: dict, body: Any, repo: str) -> list[str]:
    """Failures of an `expect` block's `json` and `checks` against a decoded body."""
    failures = []
    if "json" in expect and not json_matches(expect["json"], body, repo):
        failures.append(
            f"json mismatch:\n  expected {json.dumps(expect['json'])}\n  actual   {json.dumps(body)}"
        )
    failures.extend(check_failures(expect.get("checks", []), body, repo))
    return failures
