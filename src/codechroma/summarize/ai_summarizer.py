"""Claude-backed node-summary generation, with an offline fallback.

Falls back to deterministic, structure-derived text whenever no `ANTHROPIC_API_KEY` is configured
(checked in the process environment, then a `.env` file) or the API call fails, so the engine
works out of the box without requiring credentials.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from codechroma.config import settings
from codechroma.context.llm_provider import LLMProvider, build_provider, resolve_model
from codechroma.graph.models import AISummary, HierarchyNode
from codechroma.llm.call_site_settings import load_assignment
from codechroma.prompts import render_prompt

logger = logging.getLogger(__name__)

CALL_SITE_ID = "ai_summarizer"


class AISummarizer:
    """Generates node summaries via Claude, when available."""

    def __init__(self, provider: LLMProvider | None = None, model: str | None = None):
        self._provider = provider
        # Read at construction, not at import: a custom Settings(...) built first must win.
        self._model = model if model is not None else settings.ai_summarizer.model

    @property
    def available(self) -> bool:
        return self._provider is not None

    @classmethod
    def from_env(cls) -> AISummarizer:
        """Unassigned call site keeps today's default (FR-009); else the assigned provider/model."""
        assignment = load_assignment(CALL_SITE_ID)
        model = resolve_model(assignment, settings.ai_summarizer.model)
        return cls(provider=build_provider(assignment), model=model)

    def summarize(self, node: HierarchyNode, context: str) -> AISummary:
        text = self._generate_text(node, context)
        return AISummary(node_id=node.id, text=text, generated_at=datetime.now(UTC))

    def _generate_text(self, node: HierarchyNode, context: str) -> str:
        if self._provider is not None:
            try:
                return self._summarize_via_api(node, context)
            except Exception:
                logger.exception(
                    "Claude summary call failed for node %s; using offline fallback", node.id
                )
        return self._offline_summary(node, context)

    def _offline_summary(self, node: HierarchyNode, context: str) -> str:
        level_label = node.level.value.replace("_", " ")
        if context:
            return f"{level_label.capitalize()} `{node.name}`: {context}"
        return f"{level_label.capitalize()} `{node.name}`."

    def _summarize_via_api(self, node: HierarchyNode, context: str) -> str:
        assert self._provider is not None  # sole caller already checked this
        prompt = render_prompt(
            "ai_summarizer", key="user", node_level=node.level.value, node_name=node.name,
            context=context,
        )
        return self._provider.complete(
            user=prompt, model=self._model, max_tokens=settings.ai_summarizer.max_tokens
        )
