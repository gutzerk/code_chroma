"""Unit tests for research/indexer.py's fingerprinted embedding write."""

import json

from codechroma.graph.models import AISummary, Graph
from codechroma.research import indexer


class _FakeProvider:
    def __init__(self):
        self.calls = []

    def embed(self, texts):
        self.calls.append(list(texts))
        return [[float(len(text)), 0.0] for text in texts]


def _graph(summaries):
    entries = {
        node_id: AISummary(node_id=node_id, text=text) for node_id, text in summaries.items()
    }
    return Graph(summaries=entries)


def test_embed_node_summaries_writes_a_fingerprinted_index(tmp_path):
    graph = _graph({"function::a": "does a thing", "function::b": "does another thing"})
    provider = _FakeProvider()

    indexer.embed_node_summaries(graph, tmp_path, provider)

    data = json.loads(indexer.research_index_path(tmp_path).read_text())
    assert data["provider"] == "voyageai"
    assert {entry["node_id"] for entry in data["entries"]} == {"function::a", "function::b"}
    assert "fingerprint" in data


def test_unchanged_summaries_skip_re_embedding(tmp_path):
    graph = _graph({"function::a": "does a thing"})
    provider = _FakeProvider()
    indexer.embed_node_summaries(graph, tmp_path, provider)

    indexer.embed_node_summaries(graph, tmp_path, provider)

    assert len(provider.calls) == 1


def test_changed_summaries_trigger_re_embedding(tmp_path):
    provider = _FakeProvider()
    indexer.embed_node_summaries(_graph({"function::a": "v1"}), tmp_path, provider)

    indexer.embed_node_summaries(_graph({"function::a": "v2"}), tmp_path, provider)

    assert len(provider.calls) == 2


def test_no_summaries_writes_nothing(tmp_path):
    provider = _FakeProvider()

    indexer.embed_node_summaries(_graph({}), tmp_path, provider)

    assert not indexer.research_index_path(tmp_path).exists()


def test_provider_error_is_swallowed_and_leaves_no_index(tmp_path):
    class _FailingProvider:
        def embed(self, texts):
            from codechroma.research.embeddings_provider import EmbeddingsProviderError

            raise EmbeddingsProviderError("boom")

    indexer.embed_node_summaries(_graph({"function::a": "x"}), tmp_path, _FailingProvider())

    assert not indexer.research_index_path(tmp_path).exists()
