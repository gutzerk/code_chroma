"""Unit coverage for generate_patterns: one Claude call confirming/rejecting each candidate."""

import json

from codechroma.context.patterns_generator import generate_patterns
from codechroma.graph.models import (
    PatternInstance,
    PatternParticipant,
    PatternRelation,
    PatternRelationKind,
    PatternRole,
    PatternType,
)


def _candidate(candidate_id="strategy::discount"):
    return PatternInstance(
        id=candidate_id,
        type=PatternType.STRATEGY,
        name="Strategy candidate",
        confirmed=None,
        confidence=0.7,
        participants=[
            PatternParticipant(
                id="class::discount_strategy",
                role=PatternRole.INTERFACE,
                name="DiscountStrategy",
                qualified_name="billing.discounts.DiscountStrategy",
                node_id="class::discount_strategy",
                path="billing/discounts.py",
            ),
            PatternParticipant(
                id="class::percent_discount",
                role=PatternRole.IMPLEMENTATION,
                name="PercentDiscount",
                qualified_name="billing.discounts.PercentDiscount",
                node_id="class::percent_discount",
                path="billing/discounts.py",
            ),
        ],
    )


class _FakeProvider:
    def __init__(self, reply_text):
        self.reply_text = reply_text
        self.last_kwargs = None

    def complete(self, **kwargs):
        self.last_kwargs = kwargs
        return self.reply_text


def _confirmations_reply(entries):
    return json.dumps({"confirmations": entries})


def _instance_node(result, instance_id):
    return next(n for n in result["nodes"] if n["id"] == instance_id)


def test_confirmed_candidate_lands_in_nodes_with_the_models_name_and_description():
    candidate = _candidate()
    reply = _confirmations_reply(
        [
            {
                "id": candidate.id,
                "confirmed": True,
                "name": "Strategy — discounts",
                "description": "Real.",
            }
        ]
    )
    provider = _FakeProvider(reply)

    result = generate_patterns([candidate], provider=provider)

    node = _instance_node(result, candidate.id)
    assert node["kind"] == "pattern-instance"
    assert node["meta"]["confirmed"] is True
    assert node["name"] == "Strategy — discounts"
    assert node["description"] == "Real."


def test_rejected_candidate_still_lands_in_nodes_marked_unconfirmed():
    candidate = _candidate()
    reply = _confirmations_reply(
        [{"id": candidate.id, "confirmed": False, "name": "", "description": "Not a real fit."}]
    )
    provider = _FakeProvider(reply)

    result = generate_patterns([candidate], provider=provider)

    node = _instance_node(result, candidate.id)
    assert node["meta"]["confirmed"] is False


def test_never_lets_the_model_change_participants_or_type():
    candidate = _candidate()
    reply = _confirmations_reply(
        [{"id": candidate.id, "confirmed": True, "name": "X", "description": "Y"}]
    )
    provider = _FakeProvider(reply)

    result = generate_patterns([candidate], provider=provider)

    instance = _instance_node(result, candidate.id)
    assert instance["meta"]["type"] == "strategy"
    participant_ids = [n["id"] for n in result["nodes"] if n.get("parent") == candidate.id]
    assert participant_ids == ["class::discount_strategy", "class::percent_discount"]


def test_sends_the_candidates_in_the_prompt():
    candidate = _candidate()
    provider = _FakeProvider(_confirmations_reply([{"id": candidate.id, "confirmed": True}]))

    generate_patterns([candidate], provider=provider)

    assert candidate.id in provider.last_kwargs["user"]


def test_uses_the_haiku_model():
    candidate = _candidate()
    provider = _FakeProvider(_confirmations_reply([{"id": candidate.id, "confirmed": True}]))

    generate_patterns([candidate], provider=provider)

    assert "haiku" in provider.last_kwargs["model"]


def test_a_candidate_missing_from_the_reply_is_dropped_silently():
    candidate = _candidate()
    other = _candidate("strategy::other")
    provider = _FakeProvider(_confirmations_reply([{"id": candidate.id, "confirmed": True}]))

    result = generate_patterns([candidate, other], provider=provider)

    instance_ids = {n["id"] for n in result["nodes"] if n.get("kind") == "pattern-instance"}
    assert instance_ids == {candidate.id}


def test_returns_none_for_an_empty_candidate_list():
    provider = _FakeProvider(_confirmations_reply([]))

    result = generate_patterns([], provider=provider)

    assert result is None


def test_returns_none_when_the_reply_is_not_json():
    candidate = _candidate()
    provider = _FakeProvider("not json at all")

    result = generate_patterns([candidate], provider=provider)

    assert result is None


def test_returns_none_when_confirmations_key_is_missing():
    candidate = _candidate()
    provider = _FakeProvider(json.dumps({"oops": []}))

    result = generate_patterns([candidate], provider=provider)

    assert result is None


def test_returns_none_when_the_provider_call_raises():
    candidate = _candidate()

    class _RaisingProvider:
        def complete(self, **_kwargs):
            raise RuntimeError("api error")

    result = generate_patterns([candidate], provider=_RaisingProvider())

    assert result is None


def test_returns_none_without_a_provider_and_no_api_key(monkeypatch):
    # Set (not delete): load_dotenv() never overrides an existing env var, blocking a .env leak.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    candidate = _candidate()

    result = generate_patterns([candidate], provider=None)

    assert result is None


def test_writes_a_flat_diagram_shape_with_a_stable_fingerprint():
    candidate = _candidate()
    provider = _FakeProvider(_confirmations_reply([{"id": candidate.id, "confirmed": True}]))

    result = generate_patterns([candidate], provider=provider)

    assert result["type"] == "patterns"
    assert isinstance(result["fingerprint"], str) and result["fingerprint"]


def test_relations_kind_round_trips_through_serialization():
    candidate = _candidate()
    candidate.relations.append(
        PatternRelation(
            from_id="class::percent_discount",
            to_id="class::discount_strategy",
            kind=PatternRelationKind.IMPLEMENTS,
        )
    )
    provider = _FakeProvider(_confirmations_reply([{"id": candidate.id, "confirmed": True}]))

    result = generate_patterns([candidate], provider=provider)

    assert result["relations"][0]["kind"] == "implements"
