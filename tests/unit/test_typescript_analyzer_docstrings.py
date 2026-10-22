"""Unit tests for JSDoc/`//`-comment doc extraction and export detection in TypeScriptAnalyzer."""

import pytest

from codechroma.analyzers.typescript_analyzer import TypeScriptAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


@pytest.mark.parametrize(
    ("source", "kind", "name", "expected"),
    [
        (
            b"/** File overview. */\nfunction plain() {}\n",
            SymbolKind.MODULE,
            "mod",
            "File overview.",
        ),
        (b"// A widget.\nclass Widget {}\n", SymbolKind.CLASS, "Widget", "A widget."),
        (b"/** Helps. */\nfunction helper() {}\n", SymbolKind.FUNCTION, "helper", "Helps."),
        (
            b"class Widget {\n  /** Renders. */\n  render() {}\n}\n",
            SymbolKind.FUNCTION,
            "Widget.render",
            "Renders.",
        ),
        (
            b"/**\n * First line.\n * Second line.\n */\nfunction helper() {}\n",
            SymbolKind.FUNCTION,
            "helper",
            "First line.\nSecond line.",
        ),
    ],
    ids=["module-jsdoc", "class-line-comment", "function-jsdoc", "method-jsdoc", "multiline-jsdoc"],
)
def test_doc_comment_is_extracted(source, kind, name, expected):
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    symbol = by_kind_name(symbols, kind, name)
    assert symbol.docstring == expected


@pytest.mark.parametrize(
    ("source", "kind", "name"),
    [
        (b"function plain() {}\n", SymbolKind.MODULE, "mod"),
        (b"function helper() {}\n", SymbolKind.FUNCTION, "helper"),
    ],
    ids=["module", "function"],
)
def test_symbol_without_doc_comment_is_none(source, kind, name):
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    symbol = by_kind_name(symbols, kind, name)
    assert symbol.docstring is None


@pytest.mark.parametrize(
    ("source", "kind", "name", "expected"),
    [
        (
            b"/** Exported helper. */\nexport function helper() {}\n",
            SymbolKind.FUNCTION,
            "helper",
            "Exported helper.",
        ),
        (
            b"/** Exported widget. */\nexport class Widget {}\n",
            SymbolKind.CLASS,
            "Widget",
            "Exported widget.",
        ),
        (
            b"/** Exported arrow. */\nexport const helper = () => {};\n",
            SymbolKind.FUNCTION,
            "helper",
            "Exported arrow.",
        ),
    ],
    ids=["function", "class", "const-arrow-function"],
)
def test_exported_symbol_docstring_and_export_flag(source, kind, name, expected):
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    symbol = by_kind_name(symbols, kind, name)
    assert symbol.docstring == expected
    assert symbol.is_exported is True


@pytest.mark.parametrize(
    "source",
    [b"function helper() {}\n", b"const helper = () => {};\n"],
    ids=["function", "const-arrow-function"],
)
def test_unexported_function_export_flag_is_false(source):
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "helper")
    assert helper.is_exported is False
