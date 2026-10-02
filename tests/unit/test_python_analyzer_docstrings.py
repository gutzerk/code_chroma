"""Unit tests for docstring extraction and module-level variable extraction in PythonAnalyzer."""

from codechroma.analyzers.python_analyzer import PythonAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


def test_module_docstring_is_extracted():
    source = b'"""Module summary."""\nx = 1\n'
    symbols = PythonAnalyzer().parse("mod.py", source)

    module = by_kind_name(symbols, SymbolKind.MODULE, "mod")
    assert module.docstring == "Module summary."


def test_module_without_docstring_is_none():
    source = b"x = 1\n"
    symbols = PythonAnalyzer().parse("mod.py", source)

    module = by_kind_name(symbols, SymbolKind.MODULE, "mod")
    assert module.docstring is None


def test_class_docstring_is_extracted():
    source = b'class Widget:\n    """A widget."""\n    pass\n'
    symbols = PythonAnalyzer().parse("mod.py", source)

    widget = by_kind_name(symbols, SymbolKind.CLASS, "Widget")
    assert widget.docstring == "A widget."


def test_function_docstring_is_extracted():
    source = b'def helper():\n    """Helps."""\n    return 1\n'
    symbols = PythonAnalyzer().parse("mod.py", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "helper")
    assert helper.docstring == "Helps."


def test_method_docstring_is_extracted():
    source = b'class Widget:\n    def render(self):\n        """Renders."""\n        return 1\n'
    symbols = PythonAnalyzer().parse("mod.py", source)

    render = by_kind_name(symbols, SymbolKind.FUNCTION, "Widget.render")
    assert render.docstring == "Renders."


def test_multiline_docstring_is_dedented_via_cleandoc():
    source = b'def helper():\n    """First line.\n\n    Second line.\n    """\n    return 1\n'
    symbols = PythonAnalyzer().parse("mod.py", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "helper")
    assert helper.docstring == "First line.\n\nSecond line."


def test_decorated_function_docstring_is_still_extracted():
    source = b'@deco\ndef helper():\n    """Decorated helper."""\n    return 1\n'
    symbols = PythonAnalyzer().parse("mod.py", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "helper")
    assert helper.docstring == "Decorated helper."


def test_decorated_class_docstring_is_still_extracted():
    source = b'@deco\nclass Widget:\n    """Decorated widget."""\n    pass\n'
    symbols = PythonAnalyzer().parse("mod.py", source)

    widget = by_kind_name(symbols, SymbolKind.CLASS, "Widget")
    assert widget.docstring == "Decorated widget."


def test_function_without_docstring_is_none():
    source = b"def helper():\n    return 1\n"
    symbols = PythonAnalyzer().parse("mod.py", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "helper")
    assert helper.docstring is None


def test_simple_module_variable_is_extracted():
    source = b"BASE_DIR = 1\n"
    symbols = PythonAnalyzer().parse("mod.py", source)

    variable = by_kind_name(symbols, SymbolKind.VARIABLE, "mod.BASE_DIR")
    assert variable.name == "BASE_DIR"


def test_annotated_module_variable_is_extracted():
    source = b'ENV_FILE: str = "x"\n'
    symbols = PythonAnalyzer().parse("mod.py", source)

    variable = by_kind_name(symbols, SymbolKind.VARIABLE, "mod.ENV_FILE")
    assert variable.name == "ENV_FILE"


def test_tuple_module_variable_assignment_is_extracted():
    source = b"a, b = 1, 2\n"
    symbols = PythonAnalyzer().parse("mod.py", source)
    variable_names = {s.name for s in symbols if s.kind == SymbolKind.VARIABLE}

    assert variable_names == {"a", "b"}


def test_function_body_assignment_is_not_a_module_variable():
    source = b"def helper():\n    local = 1\n    return local\n"
    symbols = PythonAnalyzer().parse("mod.py", source)
    variables = [s for s in symbols if s.kind == SymbolKind.VARIABLE]

    assert variables == []


def test_class_body_assignment_is_not_a_module_variable():
    source = b"class Widget:\n    attr = 1\n"
    symbols = PythonAnalyzer().parse("mod.py", source)
    variables = [s for s in symbols if s.kind == SymbolKind.VARIABLE]

    assert variables == []
