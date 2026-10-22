"""Unit tests for docstring extraction and module-level variable extraction in PythonAnalyzer."""

import pytest

from codechroma.analyzers.python_analyzer import PythonAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


@pytest.mark.parametrize(
    ("source", "kind", "name", "expected"),
    [
        (b'"""Module summary."""\nx = 1\n', SymbolKind.MODULE, "mod", "Module summary."),
        (
            b'class Widget:\n    """A widget."""\n    pass\n',
            SymbolKind.CLASS,
            "Widget",
            "A widget.",
        ),
        (
            b'def helper():\n    """Helps."""\n    return 1\n',
            SymbolKind.FUNCTION,
            "helper",
            "Helps.",
        ),
        (
            b'class Widget:\n    def render(self):\n        """Renders."""\n        return 1\n',
            SymbolKind.FUNCTION,
            "Widget.render",
            "Renders.",
        ),
        (
            b'def helper():\n    """First line.\n\n    Second line.\n    """\n    return 1\n',
            SymbolKind.FUNCTION,
            "helper",
            "First line.\n\nSecond line.",
        ),
        (
            b'@deco\ndef helper():\n    """Decorated helper."""\n    return 1\n',
            SymbolKind.FUNCTION,
            "helper",
            "Decorated helper.",
        ),
        (
            b'@deco\nclass Widget:\n    """Decorated widget."""\n    pass\n',
            SymbolKind.CLASS,
            "Widget",
            "Decorated widget.",
        ),
    ],
    ids=[
        "module",
        "class",
        "function",
        "method",
        "multiline-dedented-via-cleandoc",
        "decorated-function",
        "decorated-class",
    ],
)
def test_docstring_is_extracted(source, kind, name, expected):
    symbols = PythonAnalyzer().parse("mod.py", source)

    symbol = by_kind_name(symbols, kind, name)
    assert symbol.docstring == expected


@pytest.mark.parametrize(
    ("source", "kind", "name"),
    [
        (b"x = 1\n", SymbolKind.MODULE, "mod"),
        (b"def helper():\n    return 1\n", SymbolKind.FUNCTION, "helper"),
    ],
    ids=["module", "function"],
)
def test_symbol_without_docstring_is_none(source, kind, name):
    symbols = PythonAnalyzer().parse("mod.py", source)

    symbol = by_kind_name(symbols, kind, name)
    assert symbol.docstring is None


@pytest.mark.parametrize(
    ("source", "symbol_name", "name"),
    [
        (b"BASE_DIR = 1\n", "mod.BASE_DIR", "BASE_DIR"),
        (b'ENV_FILE: str = "x"\n', "mod.ENV_FILE", "ENV_FILE"),
    ],
    ids=["simple", "annotated"],
)
def test_module_variable_is_extracted(source, symbol_name, name):
    symbols = PythonAnalyzer().parse("mod.py", source)

    variable = by_kind_name(symbols, SymbolKind.VARIABLE, symbol_name)
    assert variable.name == name


def test_tuple_module_variable_assignment_is_extracted():
    source = b"a, b = 1, 2\n"
    symbols = PythonAnalyzer().parse("mod.py", source)
    variable_names = {s.name for s in symbols if s.kind == SymbolKind.VARIABLE}

    assert variable_names == {"a", "b"}


@pytest.mark.parametrize(
    "source",
    [
        b"def helper():\n    local = 1\n    return local\n",
        b"class Widget:\n    attr = 1\n",
    ],
    ids=["function-body", "class-body"],
)
def test_nested_assignment_is_not_a_module_variable(source):
    symbols = PythonAnalyzer().parse("mod.py", source)
    variables = [s for s in symbols if s.kind == SymbolKind.VARIABLE]

    assert variables == []
