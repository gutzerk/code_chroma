"""Semantic vs. keyword search over the graph, plus the templated answer a degrade returns."""

from __future__ import annotations

import math
import re
from pathlib import Path

from codechroma.dependencies.digest import load_dependency_digest
from codechroma.graph.models import Graph
from codechroma.research.embeddings_provider import EmbeddingsProvider, embeddings_provider_from_env
from codechroma.research.indexer import load_research_index
from codechroma.research.models import ResearchAnswer, ResearchCitation, SearchHit

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> set[str]:
    """Lowercases and splits on non-alphanumerics -- good enough to match snake_case identifiers."""
    return set(_TOKEN_RE.findall(text.lower()))


def _rank(hits: list[SearchHit], top_k: int) -> list[SearchHit]:
    """Highest score first, capped to `top_k`."""
    hits.sort(key=lambda hit: hit.score, reverse=True)
    return hits[:top_k]


def _cosine(a: list[float], b: list[float]) -> float:
    """Returns 0.0 for a dimension mismatch (e.g. a stale index built by a different model)."""
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def semantic_search(
    query: str, graph: Graph, index: dict, provider: EmbeddingsProvider, top_k: int
) -> list[SearchHit]:
    """Cosine-ranks the query's embedding against every entry in a loaded research-index.json."""
    entries = index.get("entries", [])
    if not entries:
        return []
    query_vector = provider.embed([query])[0]
    hits = []
    for entry in entries:
        node_id = entry["node_id"]
        summary = graph.summaries.get(node_id)
        if summary is None:
            continue
        node = graph.nodes.get(node_id)
        hits.append(
            SearchHit(
                node_id=node_id,
                score=_cosine(query_vector, entry["embedding"]),
                summary_text=summary.text,
                path=node.source_path if node else None,
                symbol=node.name if node else None,
            )
        )
    return _rank(hits, top_k)


def _symbol_hit(entry: dict, path: str, tokens: set[str], label: str) -> SearchHit | None:
    node_id = entry.get("node_id")
    if not node_id:
        return None
    name = entry.get("name", "")
    score = len(tokens & _tokenize(name)) * 2 + len(tokens & _tokenize(path))
    if score == 0:
        return None
    return SearchHit(
        node_id=node_id, score=float(score), summary_text=f"{label} {name} in {path}",
        path=path, symbol=name,
    )


def keyword_search(query: str, digest: dict, top_k: int) -> list[SearchHit]:
    """Token-overlap ranking over dependency-digest.json -- no provider or index ever needed."""
    tokens = _tokenize(query)
    if not tokens:
        return []
    hits: list[SearchHit] = []
    for file_entry in digest.get("files", []):
        if file_entry.get("detail_omitted"):
            continue
        path = file_entry["path"]
        file_node_id = file_entry.get("node_id")
        if file_node_id:
            score = len(tokens & _tokenize(path))
            if score:
                file_hit = SearchHit(
                    node_id=file_node_id, score=float(score), summary_text=f"File {path}", path=path
                )
                hits.append(file_hit)
        for cls in file_entry.get("classes", []):
            if (hit := _symbol_hit(cls, path, tokens, "class")) is not None:
                hits.append(hit)
            for method in cls.get("methods", []):
                if (hit := _symbol_hit(method, path, tokens, "method")) is not None:
                    hits.append(hit)
        for func in file_entry.get("functions", []):
            if (hit := _symbol_hit(func, path, tokens, "function")) is not None:
                hits.append(hit)
    return _rank(hits, top_k)


def find_hits(
    query: str, graph: Graph, repo_root: Path, top_k: int
) -> tuple[list[SearchHit], bool]:
    """Picks semantic vs. keyword by whether an index+provider exist; returns (hits, semantic)."""
    index = load_research_index(repo_root)
    provider = embeddings_provider_from_env()
    if index.get("entries") and provider is not None:
        return semantic_search(query, graph, index, provider, top_k), True
    digest = load_dependency_digest(repo_root)
    return keyword_search(query, digest, top_k), False


def build_degraded_answer(query: str, hits: list[SearchHit], generated_at: str) -> ResearchAnswer:
    """A templated (non-LLM) answer over keyword hits -- never invents anything hits didn't find."""
    if not hits:
        return ResearchAnswer(
            query=query,
            answer="No relevant match was found for this question in the analyzed repository.",
            citations=[],
            degraded=True,
            generated_at=generated_at,
        )
    lines = [f"Keyword match found {len(hits)} relevant location(s):"]
    citations = []
    for position, hit in enumerate(hits, start=1):
        label = hit.symbol or hit.path or hit.node_id
        lines.append(f"[{position}] {label} — {hit.summary_text}")
        citations.append(ResearchCitation(node_id=hit.node_id, path=hit.path, symbol=hit.symbol))
    return ResearchAnswer(
        query=query, answer="\n".join(lines), citations=citations, degraded=True,
        generated_at=generated_at,
    )
