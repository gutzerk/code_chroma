"""Unit tests for JSDoc/`//`-comment doc extraction and export detection in TypeScriptAnalyzer."""

from codechroma.analyzers.typescript_analyzer import TypeScriptAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


def test_module_jsdoc_is_extracted():
    source = b"/** File overview. */\nfunction plain() {}\n"
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    module = by_kind_name(symbols, SymbolKind.MODULE, "mod")
    assert module.docstring == "File overview."


def test_module_without_doc_comment_is_none():
    source = b"function plain() {}\n"
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    module = by_kind_name(symbols, SymbolKind.MODULE, "mod")
    assert module.docstring is None


def test_class_line_comment_is_extracted():
    source = b"// A widget.\nclass Widget {}\n"
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    widget = by_kind_name(symbols, SymbolKind.CLASS, "Widget")
    assert widget.docstring == "A widget."


def test_function_jsdoc_is_extracted():
    source = b"/** Helps. */\nfunction helper() {}\n"
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "helper")
    assert helper.docstring == "Helps."


def test_method_jsdoc_is_extracted():
    source = b"class Widget {\n  /** Renders. */\n  render() {}\n}\n"
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    render = by_kind_name(symbols, SymbolKind.FUNCTION, "Widget.render")
    assert render.docstring == "Renders."


def test_function_without_comment_directly_above_is_none():
    source = b"function helper() {}\n"
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "helper")
    assert helper.docstring is None


def test_multiline_jsdoc_joins_lines():
    source = b"/**\n * First line.\n * Second line.\n */\nfunction helper() {}\n"
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "helper")
    assert helper.docstring == "First line.\nSecond line."


def test_exported_function_docstring_and_export_flag():
    source = b"/** Exported helper. */\nexport function helper() {}\n"
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "helper")
    assert helper.docstring == "Exported helper."
    assert helper.is_exported is True


def test_unexported_function_export_flag_is_false():
    source = b"function helper() {}\n"
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "helper")
    assert helper.is_exported is False


def test_exported_class_docstring_and_export_flag():
    source = b"/** Exported widget. */\nexport class Widget {}\n"
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    widget = by_kind_name(symbols, SymbolKind.CLASS, "Widget")
    assert widget.docstring == "Exported widget."
    assert widget.is_exported is True


def test_exported_const_arrow_function_docstring_and_export_flag():
    source = b"/** Exported arrow. */\nexport const helper = () => {};\n"
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "helper")
    assert helper.docstring == "Exported arrow."
    assert helper.is_exported is True


def test_unexported_const_arrow_function_export_flag_is_false():
    source = b"const helper = () => {};\n"
    symbols = TypeScriptAnalyzer().parse("mod.ts", source)

    helper = by_kind_name(symbols, SymbolKind.FUNCTION, "helper")
    assert helper.is_exported is False
