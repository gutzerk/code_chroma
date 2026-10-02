"""Integration coverage for 004: Python + Go class_shapes merge into one Graph, no cross-talk."""

from pathlib import Path

from codechroma.engine import GraphEngine
from codechroma.graph.models import PatternType
from codechroma.graph.store import SqliteGraphStore

_PYTHON_STRATEGY = b"""
from abc import ABC, abstractmethod


class DiscountStrategy(ABC):
    @abstractmethod
    def apply(self, price):
        ...


class PercentDiscount(DiscountStrategy):
    def apply(self, price):
        return price * 0.9


class FlatDiscount(DiscountStrategy):
    def apply(self, price):
        return price - 5
"""

_GO_SINGLETON = b"""
package logging

import "sync"

type Logger struct {
	prefix string
}

var instance *Logger
var once sync.Once

func GetInstance() *Logger {
	once.Do(func() {
		instance = &Logger{}
	})
	return instance
}
"""


def _make_engine(tmp_path: Path) -> GraphEngine:
    store = SqliteGraphStore(str(tmp_path / "graph.db"))
    return GraphEngine(store=store)


def test_python_and_go_patterns_coexist_in_one_graph_without_cross_contamination(tmp_path):
    repo = tmp_path / "repo"
    (repo / "billing").mkdir(parents=True)
    (repo / "logging").mkdir()
    (repo / "billing" / "discounts.py").write_bytes(_PYTHON_STRATEGY)
    (repo / "logging" / "logger.go").write_bytes(_GO_SINGLETON)
    engine = _make_engine(tmp_path)
    engine.analyze(str(repo))

    candidates = engine.snapshot().pattern_candidates

    strategy = [c for c in candidates if c.type == PatternType.STRATEGY]
    singleton = [c for c in candidates if c.type == PatternType.SINGLETON]
    assert {p.name for p in strategy[0].participants} == {
        "DiscountStrategy",
        "PercentDiscount",
        "FlatDiscount",
    }
    assert singleton[0].participants[0].name == "Logger"
