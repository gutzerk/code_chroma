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
from codechroma.llm.providers_store import capabilities, find_provider, store_path

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


@dataclass
class Fallback:
    provider_id: str | None
    model: str
    offline: bool = False


@dataclass
class DefaultAssignment:
    provider_id: str
    model: str
    quick_fallback: Fallback | None = None
    agent_fallback: Fallback | None = None


def _can(provider, needs: str) -> bool:
    caps = capabilities(provider)
    return caps.agents if needs == "agents" else caps.quick


def _validate_fallback(raw: object, needs: str, name: str) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, dict):
        return [f"{name} must be an object"]
    if raw.get("offline") is True:
        return [f"{name} cannot be offline"] if needs == "agents" else []
    provider_id = raw.get("provider_id")
    provider = find_provider(provider_id) if isinstance(provider_id, str) else None
    if provider is None:
        return [f"{name}.provider_id must reference an existing provider"]
    problems: list[str] = []
    if not _can(provider, needs):
        problems.append(f"{name} must reference a provider that can run {needs} work")
    model = raw.get("model")
    if not isinstance(model, str) or not model.strip():
        problems.append(f"{name}.model must be a non-empty string")
    return problems


def validate_default(payload: object) -> list[str]:
    """Returns a list of problems for the default model; empty means acceptable."""
    if not isinstance(payload, dict):
        return ["default must be an object"]
    provider_id = payload.get("provider_id")
    provider = find_provider(provider_id) if isinstance(provider_id, str) else None
    if provider is None:
        return ["provider_id must reference an existing provider"]
    problems: list[str] = []
    model = payload.get("model")
    if not isinstance(model, str) or not model.strip():
        problems.append("model must be a non-empty string")
    problems += _validate_fallback(payload.get("quick_fallback"), "quick", "quick_fallback")
    problems += _validate_fallback(payload.get("agent_fallback"), "agents", "agent_fallback")
    return problems


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
    if not capabilities(provider).agents:
        problems.append("an agentic group needs a provider that can drive a CLI agent")
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


def _fallback_from(raw: object) -> Fallback | None:
    if not isinstance(raw, dict):
        return None
    if raw.get("offline") is True:
        return Fallback(provider_id=None, model="", offline=True)
    provider_id = raw.get("provider_id")
    model = raw.get("model")
    if isinstance(provider_id, str) and isinstance(model, str):
        return Fallback(provider_id=provider_id, model=model)
    return None


def load_default() -> DefaultAssignment | None:
    """The stored default model, or None when no default is set."""
    data = load_json_or_none(call_site_settings_path()) or {}
    raw = data.get("default")
    if not isinstance(raw, dict):
        return None
    provider_id = raw.get("provider_id")
    model = raw.get("model")
    if not (isinstance(provider_id, str) and isinstance(model, str)):
        return None
    return DefaultAssignment(
        provider_id=provider_id,
        model=model,
        quick_fallback=_fallback_from(raw.get("quick_fallback")),
        agent_fallback=_fallback_from(raw.get("agent_fallback")),
    )


def _fallback_dict(fallback: Fallback | None) -> dict | None:
    if fallback is None:
        return None
    if fallback.offline:
        return {"offline": True}
    return {"provider_id": fallback.provider_id, "model": fallback.model}


def resolve_default(needs: str) -> tuple[Assignment | None, str]:
    """The default or its fallback for `agents`/`quick` work, with its source label."""
    default = load_default()
    if default is None:
        return None, "legacy"
    mode = "cli" if needs == "agents" else "api"
    provider = find_provider(default.provider_id)
    if provider is not None and _can(provider, needs):
        return Assignment("", default.provider_id, default.model, mode), "default"
    fallback = default.agent_fallback if needs == "agents" else default.quick_fallback
    if fallback is None:
        return None, "legacy"
    if fallback.offline:
        return Assignment("", "", "", "offline"), "offline"
    fallback_provider = find_provider(fallback.provider_id or "")
    if fallback_provider is not None and _can(fallback_provider, needs):
        return Assignment("", fallback.provider_id or "", fallback.model, mode), "fallback"
    return None, "legacy"


def load_assignment(call_site_id: str) -> Assignment | None:
    """Override, else the default (or its fallback); None keeps the caller's legacy behavior."""
    group_id = group_of(call_site_id)
    if group_id is not None:
        group_assignment = load_group_assignment(group_id)
        if group_assignment is not None:
            return Assignment(
                call_site_id=call_site_id,
                provider_id=group_assignment.provider_id,
                model=group_assignment.model,
                mode="cli",
            )
        resolved, _ = resolve_default("agents")
    else:
        override = load_assignments().get(call_site_id)
        if override is not None:
            return override
        resolved = resolve_default("quick")[0] if call_site_id in CALL_SITES else None
    if resolved is None:
        return None
    resolved.call_site_id = call_site_id
    return resolved


def _persist(
    assignments: dict[str, Assignment],
    group_assignments: dict[str, GroupAssignment],
    default: DefaultAssignment | None,
) -> None:
    default_section: dict = {}
    if default is not None:
        default_section = {
            "default": {
                "provider_id": default.provider_id,
                "model": default.model,
                "quick_fallback": _fallback_dict(default.quick_fallback),
                "agent_fallback": _fallback_dict(default.agent_fallback),
            }
        }
    write_json(
        call_site_settings_path(),
        {
            "schema_version": SCHEMA_VERSION,
            **default_section,
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
        _persist(assignments, load_group_assignments(), load_default())
        return assignment


def save_offline_assignment(call_site_id: str) -> Assignment:
    """Persists an "offline" override (no AI) for a `simple` call site; ValueError otherwise."""
    call_site = CALL_SITES.get(call_site_id)
    if call_site is None or call_site.capability != "simple":
        raise ValueError(f"{call_site_id!r} cannot run offline")
    with locked(call_site_settings_path()):
        assignments = load_assignments()
        assignment = Assignment(call_site_id=call_site_id, provider_id="", model="", mode="offline")
        assignments[call_site_id] = assignment
        _persist(assignments, load_group_assignments(), load_default())
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
        _persist(load_assignments(), group_assignments, load_default())
        return group_assignment


def save_default(payload: dict) -> DefaultAssignment:
    """Validates and persists the default model; raises ValueError on problems."""
    problems = validate_default(payload)
    if problems:
        raise ValueError("; ".join(problems))
    default = DefaultAssignment(
        provider_id=payload["provider_id"],
        model=payload["model"],
        quick_fallback=_fallback_from(payload.get("quick_fallback")),
        agent_fallback=_fallback_from(payload.get("agent_fallback")),
    )
    with locked(call_site_settings_path()):
        _persist(load_assignments(), load_group_assignments(), default)
    return default


def clear_default() -> None:
    """Removes the default model, if any -- features go back to overrides and legacy behavior."""
    with locked(call_site_settings_path()):
        if load_default() is not None:
            _persist(load_assignments(), load_group_assignments(), None)


def clear_assignment(call_site_id: str) -> None:
    """Removes call_site_id's assignment, if any -- back to "unassigned", no tombstone (FR-009)."""
    with locked(call_site_settings_path()):
        assignments = load_assignments()
        if call_site_id in assignments:
            del assignments[call_site_id]
            _persist(assignments, load_group_assignments(), load_default())


def clear_group_assignment(group_id: str) -> None:
    """Removes group_id's assignment, if any -- back to "unassigned", no tombstone."""
    with locked(call_site_settings_path()):
        group_assignments = load_group_assignments()
        if group_id in group_assignments:
            del group_assignments[group_id]
            _persist(load_assignments(), group_assignments, load_default())


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
    default = load_default()
    if default is None:
        return simple + grouped
    uses_default = default.provider_id == provider_id or any(
        fallback is not None and fallback.provider_id == provider_id
        for fallback in (default.quick_fallback, default.agent_fallback)
    )
    return simple + grouped + (["default"] if uses_default else [])
