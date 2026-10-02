"""Embeds every node summary into research-index.json when configured -- gated by fingerprint."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from codechroma.config import settings
from codechroma.graph.models import Graph
from codechroma.io import load_json, write_json
from codechroma.research.embeddings_provider import EmbeddingsProvider, EmbeddingsProviderError

logger = logging.getLogger("codechroma.research")

INDEX_FILENAME = "research-index.json"


def research_index_path(repo_root: Path) -> Path:
    return repo_root / ".codechroma" / INDEX_FILENAME


def load_research_index(repo_root: Path) -> dict:
    """Tolerates a missing or malformed file, returning {} -- absence is the degrade signal."""
    return load_json(research_index_path(repo_root))


def _fingerprint(graph: Graph) -> str:
    """A hash of every node summary's (id, text), so an unchanged repo re-embeds nothing."""
    payload = "\n".join(
        f"{node_id}\x00{summary.text}" for node_id, summary in sorted(graph.summaries.items())
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def embed_node_summaries(graph: Graph, repo_root: Path, provider: EmbeddingsProvider) -> None:
    """Writes a fingerprinted research-index.json, or does nothing if nothing changed/embeddable."""
    if not graph.summaries:
        return
    fingerprint = _fingerprint(graph)
    if load_research_index(repo_root).get("fingerprint") == fingerprint:
        return
    node_ids = sorted(graph.summaries)
    texts = [graph.summaries[node_id].text for node_id in node_ids]
    try:
        embeddings = provider.embed(texts)
    except EmbeddingsProviderError:
        logger.exception("research indexer: embedding call failed, skipping this reanalyze")
        return
    config = settings.embeddings_provider
    entries = [
        {"node_id": node_id, "embedding": embedding}
        for node_id, embedding in zip(node_ids, embeddings, strict=True)
    ]
    payload = {
        "fingerprint": fingerprint,
        "provider": "voyageai",
        "model": config.model,
        "entries": entries,
    }
    write_json(research_index_path(repo_root), payload)
