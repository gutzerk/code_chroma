"""Search hits for the research skill -- its only source of node ids (mirrors patterns_context)."""

from __future__ import annotations

from pathlib import Path

from codechroma.config import settings
from codechroma.graph.models import Graph
from codechroma.research.search import find_hits

__all__ = ["build_research_context"]


def build_research_context(graph: Graph, repo_root: Path, query: str) -> dict:
    """The payload GET /repos/{id}/research/{job_key}/context returns to the research skill."""
    hits, semantic = find_hits(query, graph, repo_root, settings.research.top_k)
    return {"query": query, "semantic": semantic, "hits": [hit.to_dict() for hit in hits]}
