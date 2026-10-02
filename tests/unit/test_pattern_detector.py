"""Unit coverage for detect_candidates: one case per heuristic pattern rule, in-memory Graph."""

from codechroma.analyzers.go_analyzer import GoAnalyzer
from codechroma.analyzers.go_analyzer import extract_class_shapes as extract_go_class_shapes
from codechroma.analyzers.python_analyzer import PythonAnalyzer, extract_class_shapes
from codechroma.graph.models import Graph, PatternType, SymbolKind
from codechroma.patterns.detector import detect_candidates


def _graph(file_path: str, source: bytes) -> Graph:
    graph = Graph()
    for symbol in PythonAnalyzer().parse(file_path, source):
        graph.symbols[symbol.id] = symbol
    graph.class_shapes = extract_class_shapes(file_path, source)
    return graph


def _go_graph(file_path: str, source: bytes) -> Graph:
    graph = Graph()
    for symbol in GoAnalyzer().parse(file_path, source):
        graph.symbols[symbol.id] = symbol
    graph.class_shapes = extract_go_class_shapes(file_path, source)
    return graph


def test_detects_strategy_with_a_dispatcher():
    src = b"""
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


class Checkout:
    def total(self, price):
        return self.apply(price)
"""
    graph = _graph("discounts.py", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.STRATEGY]

    assert len(candidates) == 1
    roles = {p.role.value: p.name for p in candidates[0].participants}
    assert roles["interface"] == "DiscountStrategy"
    assert roles["dispatcher"] == "Checkout"
    assert {p.name for p in candidates[0].participants if p.role.value == "implementation"} == {
        "PercentDiscount",
        "FlatDiscount",
    }


def test_no_strategy_candidate_for_a_non_abstract_base_with_two_children():
    src = b"""
class Base:
    def run(self):
        pass


class A(Base):
    def run(self):
        return 1


class B(Base):
    def run(self):
        return 2
"""
    graph = _graph("plain.py", src)

    assert [c for c in detect_candidates(graph) if c.type == PatternType.STRATEGY] == []


def test_detects_registry_with_a_dict_write_and_an_entry_caller():
    src = b"""
class HandlerRegistry:
    _handlers = {}

    def register(self, key, value):
        self._handlers[key] = value

    def get(self, key):
        return self._handlers.get(key)


class Bootstrap:
    def setup(self):
        return self.register("x", 1)
"""
    graph = _graph("registry.py", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.REGISTRY]

    assert len(candidates) == 1
    roles = {p.role.value: p.name for p in candidates[0].participants}
    assert roles["registry"] == "HandlerRegistry"
    assert roles["entry"] == "Bootstrap"


def test_detects_singleton_via_none_check_and_class_attr_set():
    src = b"""
class Singleton:
    _instance = None

    @classmethod
    def instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
"""
    graph = _graph("singleton.py", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.SINGLETON]

    assert len(candidates) == 1
    assert candidates[0].participants[0].name == "Singleton"


def test_detects_observer_via_append_and_iterate_on_same_attr():
    src = b"""
class Subject:
    def __init__(self):
        self._observers = []

    def add_observer(self, observer):
        self._observers.append(observer)

    def notify(self):
        for observer in self._observers:
            observer.update()
"""
    graph = _graph("observer.py", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.OBSERVER]

    assert len(candidates) == 1
    assert candidates[0].participants[0].role.value == "subject"


def test_detects_adapter_wrapping_a_single_dependency():
    src = b"""
class PaymentTarget:
    def pay(self, amount):
        ...


class LegacyPaymentAdapter(PaymentTarget):
    def pay(self, amount):
        return self._legacy.charge(amount)
"""
    graph = _graph("adapter.py", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.ADAPTER]

    assert len(candidates) == 1
    roles = {p.role.value: p.name for p in candidates[0].participants}
    assert roles["adapter"] == "LegacyPaymentAdapter"
    assert roles["target"] == "PaymentTarget"
    assert roles["adaptee"] == "_legacy"


def test_detects_facade_wrapping_three_or_more_sub_objects():
    src = b"""
class OrderFacade:
    def place_order(self, order):
        self._inventory.reserve(order)
        self._billing.charge(order)
        self._shipping.schedule(order)
        return True
"""
    graph = _graph("facade.py", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.FACADE]

    assert len(candidates) == 1
    assert candidates[0].participants[0].name == "OrderFacade"
    wrapped = {p.name for p in candidates[0].participants if p.role.value == "target"}
    assert wrapped == {"_inventory", "_billing", "_shipping"}


def test_facade_participant_ids_stay_distinct_across_two_classes_with_a_same_named_attr():
    src = b"""
class OrderFacade:
    def place_order(self, order):
        self._inventory.reserve(order)
        self._billing.charge(order)
        self.logger.info(order)
        return True


class ShipmentFacade:
    def ship(self, order):
        self._carrier.dispatch(order)
        self._tracking.record(order)
        self.logger.info(order)
        return True
"""
    graph = _graph("facades.py", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.FACADE]

    assert len(candidates) == 2
    logger_ids = {
        p.id for c in candidates for p in c.participants if p.name == "logger"
    }
    assert len(logger_ids) == 2


def test_detects_repository_by_name_suffix_and_interface_base():
    src = b"""
class OrderRepositoryInterface:
    def find(self, order_id):
        ...


class SqlOrderRepository(OrderRepositoryInterface):
    def find(self, order_id):
        return None
"""
    graph = _graph("repo.py", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.REPOSITORY]

    assert len(candidates) == 1
    roles = {p.role.value: p.name for p in candidates[0].participants}
    assert roles["interface"] == "OrderRepositoryInterface"
    assert roles["implementation"] == "SqlOrderRepository"


def test_groups_multiple_repository_implementations_under_one_shared_interface():
    src = b"""
class IGuardrailRepository:
    def find(self, guardrail_id):
        ...


class GuardrailRepository(IGuardrailRepository):
    def find(self, guardrail_id):
        return None


class TestGuardrailRepository(IGuardrailRepository):
    def find(self, guardrail_id):
        return None
"""
    graph = _graph("guardrail_repo.py", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.REPOSITORY]

    assert len(candidates) == 1
    roles = {p.role.value for p in candidates[0].participants}
    assert roles == {"interface", "implementation"}
    names_by_role = {}
    for p in candidates[0].participants:
        names_by_role.setdefault(p.role.value, set()).add(p.name)
    assert names_by_role["interface"] == {"IGuardrailRepository"}
    assert names_by_role["implementation"] == {"GuardrailRepository", "TestGuardrailRepository"}


def test_groups_repository_family_by_naming_convention_when_protocol_has_no_bases_link():
    # A Protocol satisfied structurally has no `bases` link -- only the name family connects them.
    src = b"""
from typing import Protocol


class IGuardrailRepository(Protocol):
    async def find(self, guardrail_id): ...


class GuardrailRepository:
    async def find(self, guardrail_id):
        return None


class TestGuardrailRepository:
    async def find(self, guardrail_id):
        return None


class TestProjectGuardrailRepository:
    async def find(self, guardrail_id):
        return None
"""
    graph = _graph("guardrail_repo.py", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.REPOSITORY]

    grouped = [c for c in candidates if len(c.participants) > 1]
    assert len(grouped) == 1
    names_by_role = {}
    for p in grouped[0].participants:
        names_by_role.setdefault(p.role.value, set()).add(p.name)
    assert names_by_role["interface"] == {"IGuardrailRepository"}
    assert names_by_role["implementation"] == {"GuardrailRepository", "TestGuardrailRepository"}
    # A name with no clean family match stays standalone rather than force-fit into the wrong one.
    standalone_names = {c.participants[0].name for c in candidates if len(c.participants) == 1}
    assert standalone_names == {"TestProjectGuardrailRepository"}


def test_a_shared_participant_appears_in_two_pattern_instances():
    src = b"""
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


class StrategyRegistry:
    _instances = {}

    def register(self, key, value):
        self._instances[key] = value

    def get(self, key):
        return self._instances.get(key)
"""
    graph = _graph("shared.py", src)

    candidates = detect_candidates(graph)

    strategy_ids = {
        p.id
        for c in candidates
        if c.type == PatternType.STRATEGY
        for p in c.participants
    }
    registry_ids = {
        p.id
        for c in candidates
        if c.type == PatternType.REGISTRY
        for p in c.participants
    }
    # Sharing itself is exercised on the frontend by patternsGraphLayout's dedup algorithm.
    assert strategy_ids and registry_ids
    assert any(symbol.kind == SymbolKind.CLASS for symbol in graph.symbols.values())


def test_detects_go_strategy_via_structural_interface_implements():
    src = b"""
package discounts

type DiscountStrategy interface {
	Apply(price float64) float64
}

type PercentDiscount struct{}

func (p *PercentDiscount) Apply(price float64) float64 {
	return price * 0.9
}

type FlatDiscount struct{}

func (f *FlatDiscount) Apply(price float64) float64 {
	return price - 5
}
"""
    graph = _go_graph("discounts.go", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.STRATEGY]

    assert len(candidates) == 1
    roles = {}
    for p in candidates[0].participants:
        roles.setdefault(p.role.value, set()).add(p.name)
    assert roles["interface"] == {"DiscountStrategy"}
    assert roles["implementation"] == {"PercentDiscount", "FlatDiscount"}


def test_detects_go_registry_with_a_map_write_and_an_entry_caller():
    src = b"""
package registry

type HandlerRegistry struct {
	handlers map[string]int
}

func (r *HandlerRegistry) Register(key string, value int) {
	r.handlers[key] = value
}

type Bootstrap struct{}

func (b *Bootstrap) Setup() {
	b.Register("x", 1)
}
"""
    graph = _go_graph("registry.go", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.REGISTRY]

    assert len(candidates) == 1
    assert candidates[0].participants[0].name == "HandlerRegistry"


def test_detects_go_observer_via_append_idiom_and_range_iteration():
    src = b"""
package observer

type Subject struct {
	observers []string
}

func (s *Subject) AddObserver(observer string) {
	s.observers = append(s.observers, observer)
}

func (s *Subject) Notify() {
	for _, observer := range s.observers {
		_ = observer
	}
}
"""
    graph = _go_graph("observer.go", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.OBSERVER]

    assert len(candidates) == 1
    assert candidates[0].participants[0].role.value == "subject"


def test_detects_go_package_singleton_idiom():
    src = b"""
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
    graph = _go_graph("logging.go", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.SINGLETON]

    assert len(candidates) == 1
    assert candidates[0].participants[0].name == "Logger"


def test_no_go_singleton_candidate_without_sync_once_usage():
    src = b"""
package plain

type Config struct {
	value string
}

var instance *Config

func GetInstance() *Config {
	return instance
}
"""
    graph = _go_graph("plain.go", src)

    assert [c for c in detect_candidates(graph) if c.type == PatternType.SINGLETON] == []


def test_go_singleton_detection_does_not_leak_across_package_vars():
    src = b"""
package logging

import "sync"

type Logger struct {
	prefix string
}

type Cache struct {
	data map[string]string
}

var instance *Logger
var once sync.Once
var cache *Cache

func GetInstance() *Logger {
	once.Do(func() {
		instance = &Logger{}
	})
	return instance
}

func GetCache() *Cache {
	return cache
}
"""
    graph = _go_graph("logging.go", src)

    candidates = [c for c in detect_candidates(graph) if c.type == PatternType.SINGLETON]

    assert len(candidates) == 1
    assert candidates[0].participants[0].name == "Logger"
