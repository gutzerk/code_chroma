"""The shapes research/search.py, research_context.py and routes/research.py all pass around."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class SearchHit:
    """One matched node, ranked by score -- semantic cosine similarity or keyword overlap count."""

    node_id: str
    score: float
    summary_text: str
    path: str | None = None
    symbol: str | None = None

    def to_dict(self) -> dict:
        return {
            "node_id": self.node_id,
            "score": self.score,
            "summary_text": self.summary_text,
            "path": self.path,
            "symbol": self.symbol,
        }


@dataclass(slots=True)
class ResearchCitation:
    """A pointer from an answer's prose to one real, resolvable node."""

    node_id: str
    path: str | None = None
    symbol: str | None = None

    def to_dict(self) -> dict:
        return {"node_id": self.node_id, "path": self.path, "symbol": self.symbol}


@dataclass(slots=True)
class ResearchAnswer:
    """The synthesized (or templated, if degraded) response to one research question."""

    query: str
    answer: str
    citations: list[ResearchCitation] = field(default_factory=list)
    degraded: bool = False
    generated_at: str = ""

    def to_dict(self) -> dict:
        return {
            "query": self.query,
            "answer": self.answer,
            "citations": [citation.to_dict() for citation in self.citations],
            "degraded": self.degraded,
            "generated_at": self.generated_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> ResearchAnswer:
        citations = [
            ResearchCitation(
                node_id=c["node_id"], path=c.get("path"), symbol=c.get("symbol")
            )
            for c in data.get("citations", [])
        ]
        return cls(
            query=data.get("query", ""),
            answer=data.get("answer", ""),
            citations=citations,
            degraded=bool(data.get("degraded", False)),
            generated_at=data.get("generated_at", ""),
        )
