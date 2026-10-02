"""Machine-local per-call-site assignments: `~/.codechroma/llm-call-site-settings.json`.

A call site absent from this store is "unassigned" -- no row, no tombstone (FR-009). Mirrors
`providers_store.py`'s idiom: dataclass + free `validate()`/`load_...()`/`save_...()` functions.
`simple` call sites are assigned individually; `agentic` ones are assigned by their group
(`call_sites.GROUPS`) so one provider choice covers every skill in that group at once.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from codechroma.io import load_json_or_none, locked, write_json
from codechroma.llm.call_sites import CALL_SITES, GROUPS, group_of
from codechroma.llm.providers_store import find_provider, store_path

CALL_SITE_SETTINGS_ENV = "codechroma_LLM_CALL_SITE_SETTINGS_FILE"
SCHEMA_VERSION = 1

MODES = ("cli", "api")


def call_site_settings_path() -> Path:
    """The store file: `$codechroma_LLM_CALL_SITE_SETTINGS_FILE` when set, else `~/.codechroma/`."""
    return store_path(CALL_SITE_SETTINGS_ENV, "llm-call-site-settings.json")


@dataclass
class Assignment:
    call_site_id: str
    provider_id: str
    model: str
    mode: str


@dataclass
class GroupAssignment:
    group_id: str
    provider_id: str
    model: str


def validate(payload: object) -> list[str]:
    """Returns a list of problems for a `simple` call-site assignment; empty means acceptable."""
    if not isinstance(payload, dict):
        return ["assignment must be an object"]
    problems: list[str] = []
    call_site_id = payload.get("call_site_id")
    call_site = CALL_SITES.get(call_site_id) if isinstance(call_site_id, str) else None
    if call_site is None:
        problems.append(f"call_site_id must be one of {sorted(CALL_SITES)}")
        return problems
    if call_site.capability == "agentic":
        assert isinstance(call_site_id, str)  # call_site is only non-None when this held, above
        problems.append(
            f"{call_site_id!r} is agentic; assign its group ({group_of(call_site_id)!r}) via "
            "PUT /llm/call-site-groups instead"
        )
        return problems
    provider_id = payload.get("provider_id")
    provider = find_provider(provider_id) if isinstance(provider_id, str) else None
    if provider is None:
        problems.append("provider_id must reference an existing provider")
        return problems
    model = payload.get("model")
    if not isinstance(model, str) or not model.strip():
        problems.append("model must be a non-empty string")
    mode = payload.get("mode")
    if mode not in MODES:
        problems.append(f"mode must be one of {MODES}")
        return problems
    if mode == "api" and provider.kind != "api":
        problems.append("mode=api requires a provider of kind=api")
    if mode == "cli" and provider.kind != "cli":
        problems.append("mode=cli requires a provider of kind=cli")
    return problems


def validate_group(payload: object) -> list[str]:
    """Returns a list of problems for an agentic group assignment; empty means acceptable."""
    if not isinstance(payload, dict):
        return ["assignment must be an object"]
    problems: list[str] = []
    group_id = payload.get("group_id")
    if not isinstance(group_id, str) or group_id not in GROUPS:
        problems.append(f"group_id must be one of {sorted(GROUPS)}")
        return problems
    provider_id = payload.get("provider_id")
    provider = find_provider(provider_id) if isinstance(provider_id, str) else None
    if provider is None:
        problems.append("provider_id must reference an existing provider")
        return problems
    if provider.kind != "cli":
        problems.append("an agentic group can only be assigned a provider of kind=cli")
    model = payload.get("model")
    if not isinstance(model, str) or not model.strip():
        problems.append("model must be a non-empty string")
    return problems


def load_assignments() -> dict[str, Assignment]:
    """Every stored `simple` assignment, keyed by call_site_id; empty when nothing's saved yet."""
    data = load_json_or_none(call_site_settings_path()) or {}
    raw = data.get("assignments", {})
    if not isinstance(raw, dict):
        return {}
    result: dict[str, Assignment] = {}
    for call_site_id, entry in raw.items():
        if not isinstance(entry, dict):
            continue
        provider_id = entry.get("provider_id")
        model = entry.get("model")
        mode = entry.get("mode")
        if not (isinstance(provider_id, str) and isinstance(model, str) and isinstance(mode, str)):
            continue
        result[call_site_id] = Assignment(
            call_site_id=call_site_id, provider_id=provider_id, model=model, mode=mode
        )
    return result


def load_group_assignments() -> dict[str, GroupAssignment]:
    """Every stored agentic group assignment, keyed by group_id; empty when nothing's saved yet."""
    data = load_json_or_none(call_site_settings_path()) or {}
    raw = data.get("group_assignments", {})
    if not isinstance(raw, dict):
        return {}
    result: dict[str, GroupAssignment] = {}
    for group_id, entry in raw.items():
        if group_id not in GROUPS or not isinstance(entry, dict):
            continue
        provider_id = entry.get("provider_id")
        model = entry.get("model")
        if not (isinstance(provider_id, str) and isinstance(model, str)):
            continue
        result[group_id] = GroupAssignment(group_id=group_id, provider_id=provider_id, model=model)
    return result


def load_group_assignment(group_id: str) -> GroupAssignment | None:
    return load_group_assignments().get(group_id)


def load_assignment(call_site_id: str) -> Assignment | None:
    """The effective assignment for any call site -- delegates agentic ids to their group."""
    group_id = group_of(call_site_id)
    if group_id is not None:
        group_assignment = load_group_assignment(group_id)
        if group_assignment is None:
            return None
        return Assignment(
            call_site_id=call_site_id,
            provider_id=group_assignment.provider_id,
            model=group_assignment.model,
            mode="cli",
        )
    return load_assignments().get(call_site_id)


def _persist(
    assignments: dict[str, Assignment], group_assignments: dict[str, GroupAssignment]
) -> None:
    write_json(
        call_site_settings_path(),
        {
            "schema_version": SCHEMA_VERSION,
            "assignments": {
                call_site_id: {
                    "provider_id": assignment.provider_id,
                    "model": assignment.model,
                    "mode": assignment.mode,
                }
                for call_site_id, assignment in assignments.items()
            },
            "group_assignments": {
                group_id: {
                    "provider_id": group_assignment.provider_id,
                    "model": group_assignment.model,
                }
                for group_id, group_assignment in group_assignments.items()
            },
        },
    )


def save_assignment(call_site_id: str, payload: dict) -> Assignment:
    """Validates and persists one `simple` call site's assignment; raises ValueError on problems."""
    full_payload = {**payload, "call_site_id": call_site_id}
    problems = validate(full_payload)
    if problems:
        raise ValueError("; ".join(problems))
    with locked(call_site_settings_path()):
        assignments = load_assignments()
        assignment = Assignment(
            call_site_id=call_site_id,
            provider_id=payload["provider_id"],
            model=payload["model"],
            mode=payload["mode"],
        )
        assignments[call_site_id] = assignment
        _persist(assignments, load_group_assignments())
        return assignment


def save_group_assignment(group_id: str, payload: dict) -> GroupAssignment:
    """Validates and persists one agentic group's assignment; raises ValueError on problems."""
    full_payload = {**payload, "group_id": group_id}
    problems = validate_group(full_payload)
    if problems:
        raise ValueError("; ".join(problems))
    with locked(call_site_settings_path()):
        group_assignments = load_group_assignments()
        group_assignment = GroupAssignment(
            group_id=group_id, provider_id=payload["provider_id"], model=payload["model"]
        )
        group_assignments[group_id] = group_assignment
        _persist(load_assignments(), group_assignments)
        return group_assignment


def clear_assignment(call_site_id: str) -> None:
    """Removes call_site_id's assignment, if any -- back to "unassigned", no tombstone (FR-009)."""
    with locked(call_site_settings_path()):
        assignments = load_assignments()
        if call_site_id in assignments:
            del assignments[call_site_id]
            _persist(assignments, load_group_assignments())


def clear_group_assignment(group_id: str) -> None:
    """Removes group_id's assignment, if any -- back to "unassigned", no tombstone."""
    with locked(call_site_settings_path()):
        group_assignments = load_group_assignments()
        if group_id in group_assignments:
            del group_assignments[group_id]
            _persist(load_assignments(), group_assignments)


def blocking_call_sites(provider_id: str) -> list[str]:
    """Every call site still assigned to provider_id -- what a provider delete blocks on."""
    simple = [
        call_site_id
        for call_site_id, assignment in load_assignments().items()
        if assignment.provider_id == provider_id
    ]
    grouped = [
        member
        for group_assignment in load_group_assignments().values()
        if group_assignment.provider_id == provider_id
        for member in GROUPS[group_assignment.group_id].members
    ]
    return simple + grouped
