"""Unit tests for Doxygen doc extraction in CppAnalyzer, and its `.h` resolution."""

from codechroma.analyzers.cpp_analyzer import CppAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


def test_class_doc_comment_is_extracted():
    source = (
        b"/**\n * A greeter.\n */\nclass Greeter {\npublic:\n    int hello() { return 1; }\n};\n"
    )
    symbols = CppAnalyzer().parse("greeter.hpp", source)

    greeter = by_kind_name(symbols, SymbolKind.CLASS, "Greeter")
    assert greeter.docstring == "A greeter."


def test_method_without_doc_comment_is_none():
    source = b"class Greeter {\npublic:\n    int hello() { return 1; }\n};\n"
    symbols = CppAnalyzer().parse("greeter.hpp", source)

    hello = by_kind_name(symbols, SymbolKind.FUNCTION, "Greeter.hello")
    assert hello.docstring is None


def test_h_extension_resolves_through_cpp_analyzer():
    """The `.h` -> C++ resolution is a deliberate registry-level exception (see data-model.md)."""
    source = (
        b"/**\n * A greeter.\n */\nclass Greeter {\npublic:\n    int hello() { return 1; }\n};\n"
    )
    symbols = CppAnalyzer().parse("greeter.h", source)

    greeter = by_kind_name(symbols, SymbolKind.CLASS, "Greeter")
    assert greeter.docstring == "A greeter."


def test_out_of_line_method_definition_is_attached_to_its_class():
    source = (
        b"class Greeter {\npublic:\n    int hello(int x);\n};\n\n"
        b"int Greeter::hello(int x) {\n    return x;\n}\n"
    )
    symbols = CppAnalyzer().parse("greeter.cpp", source)

    hello = by_kind_name(symbols, SymbolKind.FUNCTION, "Greeter.hello")
    assert hello.parent_symbol_id == by_kind_name(symbols, SymbolKind.CLASS, "Greeter").id
