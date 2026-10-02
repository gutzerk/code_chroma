"""Unit tests for Javadoc `/** */` doc extraction in JavaAnalyzer."""

from codechroma.analyzers.java_analyzer import JavaAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


def test_class_doc_comment_is_extracted():
    source = b"/**\n * A greeter.\n */\npublic class Greeter {\n    int hi() { return 1; }\n}\n"
    symbols = JavaAnalyzer().parse("Greeter.java", source)

    greeter = by_kind_name(symbols, SymbolKind.CLASS, "Greeter")
    assert greeter.docstring == "A greeter."


def test_method_doc_comment_is_extracted():
    source = (
        b"public class Greeter {\n    /**\n     * Says hello.\n     */\n"
        b"    public int hello() { return 1; }\n}\n"
    )
    symbols = JavaAnalyzer().parse("Greeter.java", source)

    hello = by_kind_name(symbols, SymbolKind.FUNCTION, "Greeter.hello")
    assert hello.docstring == "Says hello."


def test_method_without_doc_comment_is_none():
    source = b"public class Greeter {\n    public int hello() { return 1; }\n}\n"
    symbols = JavaAnalyzer().parse("Greeter.java", source)

    hello = by_kind_name(symbols, SymbolKind.FUNCTION, "Greeter.hello")
    assert hello.docstring is None


def test_constructor_is_captured_as_a_function_symbol():
    source = (
        b"public class Greeter {\n    public Greeter(String name) {\n"
        b"        this.name = name;\n    }\n}\n"
    )
    symbols = JavaAnalyzer().parse("Greeter.java", source)

    ctor = by_kind_name(symbols, SymbolKind.FUNCTION, "Greeter.Greeter")
    assert ctor.parent_symbol_id == by_kind_name(symbols, SymbolKind.CLASS, "Greeter").id
