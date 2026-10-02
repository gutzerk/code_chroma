"""Unit tests for XML `///` doc-comment extraction and tag-stripping in CSharpAnalyzer."""

from codechroma.analyzers.csharp_analyzer import CSharpAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


def test_method_doc_comment_strips_summary_tags():
    source = (
        b"public class Greeter {\n    /// <summary>\n    /// Says hello.\n    /// </summary>\n"
        b"    public int Hello() { return 1; }\n}\n"
    )
    symbols = CSharpAnalyzer().parse("Greeter.cs", source)

    hello = by_kind_name(symbols, SymbolKind.FUNCTION, "Greeter.Hello")
    assert hello.docstring == "Says hello."


def test_method_without_doc_comment_is_none():
    source = b"public class Greeter {\n    public int Hello() { return 1; }\n}\n"
    symbols = CSharpAnalyzer().parse("Greeter.cs", source)

    hello = by_kind_name(symbols, SymbolKind.FUNCTION, "Greeter.Hello")
    assert hello.docstring is None


def test_class_doc_comment_is_extracted():
    source = (
        b"/// <summary>\n/// A greeter class.\n/// </summary>\n"
        b"public class Greeter {\n    public int Hello() { return 1; }\n}\n"
    )
    symbols = CSharpAnalyzer().parse("Greeter.cs", source)

    greeter = by_kind_name(symbols, SymbolKind.CLASS, "Greeter")
    assert greeter.docstring == "A greeter class."
