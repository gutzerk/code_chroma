"""Unit coverage for extract_class_shapes: bases/decorators/attribute-usage from Python source."""

from codechroma.analyzers.python_analyzer import extract_class_shapes


def test_extracts_bases_and_marks_abc_classes_abstract():
    src = b"""
from abc import ABC, abstractmethod


class Shape(ABC):
    @abstractmethod
    def area(self):
        ...
"""
    shapes = extract_class_shapes("shapes.py", src)

    shape = shapes["shapes.py::class::Shape"]
    assert shape.bases == ["ABC"]
    assert shape.is_abstract is True
    assert shape.methods["area"].decorators == ["abstractmethod"]


def test_finds_a_decorated_class_that_visit_would_otherwise_skip():
    src = b"""
import dataclasses


@dataclasses.dataclass
class Config:
    name: str
"""
    shapes = extract_class_shapes("config.py", src)

    assert "config.py::class::Config" in shapes
    assert shapes["config.py::class::Config"].decorators == ["dataclasses.dataclass"]


def test_tracks_dict_writes_reads_appends_and_iteration_on_self_attrs():
    src = b"""
class Cache:
    def use(self, key, value):
        self._store[key] = value
        found = self._store.get(key)
        self._log.append(value)
        for item in self._items:
            pass
        return found
"""
    shapes = extract_class_shapes("cache.py", src)

    method = shapes["cache.py::class::Cache"].methods["use"]
    assert method.writes_dict_attrs == ["_store"]
    assert method.reads_dict_attrs == ["_store"]
    assert method.appends_list_attrs == ["_log"]
    assert method.iterates_attrs == ["_items"]
    assert method.calls_on_attr == {"_store": ["get"], "_log": ["append"]}


def test_tracks_class_attr_set_and_none_check_for_singleton_shape():
    src = b"""
class Singleton:
    _instance = None

    @classmethod
    def instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
"""
    shapes = extract_class_shapes("singleton.py", src)

    shape = shapes["singleton.py::class::Singleton"]
    assert shape.class_attrs == {"_instance": "none"}
    method = shape.methods["instance"]
    assert method.checks_none_class_attr == ["_instance"]
    assert method.sets_class_attr == ["_instance"]


def test_class_id_matches_the_symbol_id_python_analyzer_parse_assigns():
    from codechroma.analyzers.python_analyzer import PythonAnalyzer

    src = b"class Widget:\n    pass\n"
    symbols = PythonAnalyzer().parse("widgets.py", src)
    shapes = extract_class_shapes("widgets.py", src)

    class_symbol = next(s for s in symbols if s.name == "Widget")
    assert class_symbol.id in shapes


def test_nested_and_local_classes_get_qualified_ids():
    src = b"""
class Outer:
    class Inner:
        pass


def factory():
    class Local:
        pass
    return Local
"""
    shapes = extract_class_shapes("nested.py", src)

    assert set(shapes) == {
        "nested.py::class::Outer",
        "nested.py::class::Outer.Inner",
        "nested.py::class::factory.Local",
    }
