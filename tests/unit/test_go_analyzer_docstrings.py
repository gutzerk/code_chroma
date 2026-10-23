"""Unit tests for `//`-comment doc extraction and export detection in GoAnalyzer."""

import pytest

from codechroma.analyzers.go_analyzer import GoAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


@pytest.mark.parametrize(
    ("source", "kind", "name", "expected"),
    [
        (
            b"// Package widget renders things.\npackage widget\n\nfunc Helper() {}\n",
            SymbolKind.MODULE,
            "widget",
            "Package widget renders things.",
        ),
        (
            b"package widget\n\n// Widget is a thing.\ntype Widget struct{}\n",
            SymbolKind.CLASS,
            "Widget",
            "Widget is a thing.",
        ),
        (
            b"package widget\n\n// Helper does the work.\nfunc Helper() {}\n",
            SymbolKind.FUNCTION,
            "Helper",
            "Helper does the work.",
        ),
        (
            b"package widget\n\ntype Widget struct{}\n\n"
            b"// Render draws the widget.\nfunc (w *Widget) Render() {}\n",
            SymbolKind.FUNCTION,
            "Widget.Render",
            "Render draws the widget.",
        ),
        (
            b"package widget\n\n// Helper does the work.\n// It takes no arguments.\n"
            b"func Helper() {}\n",
            SymbolKind.FUNCTION,
            "Helper",
            "Helper does the work.\nIt takes no arguments.",
        ),
    ],
    ids=["module", "type", "function", "method", "multiline-joins-contiguous-lines"],
)
def test_doc_comment_is_extracted(source, kind, name, expected):
    symbols = GoAnalyzer().parse("widget.go", source)

    symbol = by_kind_name(symbols, kind, name)
    assert symbol.docstring == expected


@pytest.mark.parametrize(
    ("source", "kind", "name"),
    [
        (b"package widget\n\nfunc Helper() {}\n", SymbolKind.MODULE, "widget"),
        (
            b"package widget\n\n// Unrelated.\n\nfunc Helper() {}\n",
            SymbolKind.FUNCTION,
            "Helper",
        ),
    ],
    ids=["module-without-comment", "function-without-comment-directly-above"],
)
def test_symbol_without_doc_comment_is_none(source, kind, name):
    symbols = GoAnalyzer().parse("widget.go", source)

    symbol = by_kind_name(symbols, kind, name)
    assert symbol.docstring is None


@pytest.mark.parametrize(
    ("source", "kind", "name", "expected"),
    [
        (b"package widget\n\nfunc Helper() {}\n", SymbolKind.FUNCTION, "Helper", True),
        (b"package widget\n\nfunc helper() {}\n", SymbolKind.FUNCTION, "helper", False),
        (b"package widget\n\ntype Widget struct{}\n", SymbolKind.CLASS, "Widget", True),
    ],
    ids=["capitalized-function", "lowercase-function", "capitalized-type"],
)
def test_export_flag_follows_capitalization(source, kind, name, expected):
    symbols = GoAnalyzer().parse("widget.go", source)

    symbol = by_kind_name(symbols, kind, name)
    assert symbol.is_exported is expected
