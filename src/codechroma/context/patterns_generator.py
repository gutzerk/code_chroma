"""One-shot AI confirmation pass over the free heuristic pattern candidates.

Called at most once per repo — only when `.codechroma/patterns.json` doesn't exist yet and an
Anthropic client is configured. `patterns/detector.py` already found the candidates for free on
every analyze(); this makes a single Claude call to confirm/reject/name each one. It deliberately
does not invent new instances or infra/external `nodes`/`relations` — that stays the deeper
codechroma-patterns skill's job, run later from the canvas.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from codechroma.config import settings
from codechroma.context.llm_provider import (
    LLMProvider,
    build_provider,
    provider_from_env,
    resolve_model,
)
from codechroma.graph.models import PatternInstance
from codechroma.llm.call_site_settings import load_assignment
from codechroma.patterns.serialize import (
    fingerprint_for,
    instance_node,
    participant_node,
    serialize_instance,
)
from codechroma.prompts import render_prompt

__all__ = ["generate_patterns", "provider_from_env"]

# c1's bootstrap is a deterministic table lookup now (043) -- this call site is patterns-only.
CALL_SITE_ID = "initial_diagram_bootstrap"


def generate_patterns(
    candidates: list[PatternInstance], provider: LLMProvider | None = None
) -> dict | None:
    """One Claude call confirming/rejecting each heuristic candidate, or None on any failure."""
    if not candidates:
        return None
    assignment = load_assignment(CALL_SITE_ID)
    provider = provider or build_provider(assignment)
    if provider is None:
        return None
    model = resolve_model(assignment, settings.patterns_generator.model)
    serialized = [serialize_instance(candidate) for candidate in candidates]
    prompt = render_prompt(
        "patterns_generator", key="user", candidates_json=json.dumps(serialized, indent=2)
    )
    try:
        text = provider.complete(
            user=prompt,
            model=model,
            max_tokens=settings.patterns_generator.max_tokens,
            system=render_prompt("patterns_generator", key="system"),
        )
        data = json.loads(text)
    except Exception:
        return None
    return _build_patterns_json(candidates, serialized, data)


def _build_patterns_json(
    candidates: list[PatternInstance], serialized: list[dict], data: object
) -> dict | None:
    """Merges each confirmation onto its candidate's own shape, flattened to nodes/relations."""
    if not isinstance(data, dict):
        return None
    confirmations = data.get("confirmations")
    if not isinstance(confirmations, list):
        return None
    by_id = {
        item["id"]: item
        for item in confirmations
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    nodes: list[dict] = []
    relations: list[dict] = []
    matched_any = False
    for instance_json in serialized:
        confirmation = by_id.get(instance_json["id"])
        if confirmation is None:
            continue
        merged = _merge_confirmation(instance_json, confirmation)
        matched_any = True
        nodes.append(instance_node(merged))
        for participant in merged["participants"]:
            nodes.append(participant_node(participant, merged["id"]))
        relations.extend(merged["relations"])
    if not matched_any:
        return None
    return {
        "type": "patterns",
        "generated_at": datetime.now(UTC).isoformat(),
        "nodes": nodes,
        "relations": relations,
        "fingerprint": fingerprint_for(candidates),
    }


def _merge_confirmation(instance_json: dict, confirmation: dict) -> dict:
    """Only `confirmed`/`name`/`description` come from the model — participants stay real."""
    merged = dict(instance_json)
    merged["confirmed"] = bool(confirmation.get("confirmed"))
    name = confirmation.get("name")
    if isinstance(name, str) and name:
        merged["name"] = name
    description = confirmation.get("description")
    if isinstance(description, str) and description:
        merged["description"] = description
    return merged
