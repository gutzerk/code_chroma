"""Unit tests for `//`-comment doc extraction and export detection in GoAnalyzer."""

from codechroma.analyzers.go_analyzer import GoAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


def test_module_doc_comment_is_extracted():
    source = b"// Package widget renders things.\npackage widget\n\nfunc Helper() {}\n"
    symbols = GoAnalyzer().parse("widget.go", source)

    module = by_kind_name(symbols, SymbolKind.MODULE, "widget")
    assert module.docstring == "Package widget renders things."


def test_module_without_doc_comment_is_none():
    source = b"package widget\n\nfunc Helper() {}\n"
    symbols = GoAnalyzer().parse("widget.go", source)

    module = by_kind_name(symbols, SymbolKind.MODULE, "widget")
    assert module.docstring is None


def test_type_doc_comment_is_extracted():
    source = b"package widget\n\n// Widget is a thing.\ntype Widget struct{}\n"
    symbols = GoAnalyzer().parse("widget.go", source)

    widget = by_kind_name(symbols, SymbolKind.CLASS, "Widget")
    assert widget.docstring == "Widget is a thing."


def test_function_doc_comment_is_extracted():
    source = b"package widget\n\n// Helper does the work.\nfunc Helper() {}\n"
    symbols = GoAnalyzer().parse("widget.go", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "Helper")
    assert helper.docstring == "Helper does the work."


def test_method_doc_comment_is_extracted():
    source = (
        b"package widget\n\ntype Widget struct{}\n\n"
        b"// Render draws the widget.\nfunc (w *Widget) Render() {}\n"
    )
    symbols = GoAnalyzer().parse("widget.go", source)

    render = by_kind_name(symbols, SymbolKind.FUNCTION, "Widget.Render")
    assert render.docstring == "Render draws the widget."


def test_multiline_doc_comment_joins_contiguous_lines():
    source = (
        b"package widget\n\n// Helper does the work.\n// It takes no arguments.\nfunc Helper() {}\n"
    )
    symbols = GoAnalyzer().parse("widget.go", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "Helper")
    assert helper.docstring == "Helper does the work.\nIt takes no arguments."


def test_function_without_comment_directly_above_is_none():
    source = b"package widget\n\n// Unrelated.\n\nfunc Helper() {}\n"
    symbols = GoAnalyzer().parse("widget.go", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "Helper")
    assert helper.docstring is None


def test_capitalized_function_is_exported():
    source = b"package widget\n\nfunc Helper() {}\n"
    symbols = GoAnalyzer().parse("widget.go", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "Helper")
    assert helper.is_exported is True


def test_lowercase_function_is_not_exported():
    source = b"package widget\n\nfunc helper() {}\n"
    symbols = GoAnalyzer().parse("widget.go", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "helper")
    assert helper.is_exported is False


def test_capitalized_type_is_exported():
    source = b"package widget\n\ntype Widget struct{}\n"
    symbols = GoAnalyzer().parse("widget.go", source)

    widget = by_kind_name(symbols, SymbolKind.CLASS, "Widget")
    assert widget.is_exported is True
