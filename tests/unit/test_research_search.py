"""Unit tests for research/search.py's semantic and keyword branches."""

from codechroma.graph.models import AISummary, Graph, HierarchyLevel, HierarchyNode
from codechroma.research import search

_DIGEST = {
    "files": [
        {
            "path": "src/auth/jwt.py",
            "node_id": "component::src/auth/jwt.py",
            "classes": [],
            "functions": [
                {
                    "id": "f1",
                    "node_id": "function::src/auth/jwt.py::validate_jwt",
                    "name": "validate_jwt",
                }
            ],
        },
        {"path": "src/other.py", "detail_omitted": True},
    ]
}


class _FakeProvider:
    def embed(self, texts):
        return [[1.0, 0.0] for _ in texts]


def _graph_with_summary(node_id, text):
    node = HierarchyNode(
        id=node_id, name="validate_jwt", level=HierarchyLevel.FUNCTION,
        source_path="src/auth/jwt.py",
    )
    summaries = {node_id: AISummary(node_id=node_id, text=text)}
    return Graph(nodes={node_id: node}, summaries=summaries)


def test_semantic_search_ranks_by_cosine_similarity():
    node_id = "function::src/auth/jwt.py::validate_jwt"
    graph = _graph_with_summary(node_id, "validates a JWT signature")
    index = {"entries": [{"node_id": node_id, "embedding": [1.0, 0.0]}]}

    hits = search.semantic_search("jwt", graph, index, _FakeProvider(), top_k=5)

    assert hits[0].node_id == node_id
    assert hits[0].summary_text == "validates a JWT signature"


def test_semantic_search_scores_a_dimension_mismatch_as_zero_instead_of_raising():
    node_id = "function::src/auth/jwt.py::validate_jwt"
    graph = _graph_with_summary(node_id, "validates a JWT signature")
    index = {"entries": [{"node_id": node_id, "embedding": [1.0, 0.0, 0.0]}]}

    hits = search.semantic_search("jwt", graph, index, _FakeProvider(), top_k=5)

    assert hits[0].score == 0.0


def test_semantic_search_returns_nothing_for_an_empty_index():
    graph = Graph()

    hits = search.semantic_search("jwt", graph, {"entries": []}, _FakeProvider(), top_k=5)

    assert hits == []


def test_keyword_search_matches_function_name_tokens():
    hits = search.keyword_search("jwt validate", _DIGEST, top_k=5)

    assert hits[0].node_id == "function::src/auth/jwt.py::validate_jwt"


def test_keyword_search_skips_detail_omitted_files():
    hits = search.keyword_search("other", _DIGEST, top_k=5)

    assert hits == []


def test_keyword_search_returns_nothing_for_no_token_overlap():
    hits = search.keyword_search("completely unrelated term", _DIGEST, top_k=5)

    assert hits == []


def test_build_degraded_answer_with_hits_cites_every_hit():
    hits = [search.SearchHit(node_id="function::a", score=1.0, summary_text="does a thing")]

    answer = search.build_degraded_answer("where is a", hits, "2026-01-01T00:00:00Z")

    assert answer.degraded is True
    assert answer.citations[0].node_id == "function::a"


def test_build_degraded_answer_with_no_hits_reports_no_match():
    answer = search.build_degraded_answer("nonsense question", [], "2026-01-01T00:00:00Z")

    assert answer.citations == []
    assert "no relevant match" in answer.answer.lower()
