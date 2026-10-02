"""Integration test: reanalyze reuses cached summaries for files it didn't touch."""

import shutil
from pathlib import Path

from codechroma.engine import GraphEngine
from codechroma.graph.models import AISummary, HierarchyNode
from codechroma.graph.store import SqliteGraphStore
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


class SpySummarizer:
    def __init__(self) -> None:
        self._offline = AISummarizer()
        self.summarized_ids: list[str] = []

    def summarize(self, node: HierarchyNode, context: str) -> AISummary:
        self.summarized_ids.append(node.id)
        return self._offline.summarize(node, context)


def test_reanalyze_only_resummarizes_changed_files(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    spy = SpySummarizer()
    store = SqliteGraphStore(str(tmp_path / "graph.db"))
    engine = GraphEngine(summarizer=spy, store=store)
    engine.analyze(str(repo))

    spy.summarized_ids.clear()
    (repo / "users" / "service.py").write_text(
        (repo / "users" / "service.py").read_text() + "\n\ndef noop():\n    return 1\n"
    )
    engine.reanalyze(["users/service.py"])

    assert any("users/service.py" in node_id for node_id in spy.summarized_ids)
    assert not any(node_id.endswith("::function::slugify") for node_id in spy.summarized_ids)
