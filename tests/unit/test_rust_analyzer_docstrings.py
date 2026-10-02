"""Unit tests for `///`-item and `//!`-module doc-comment extraction in RustAnalyzer."""

from codechroma.analyzers.rust_analyzer import RustAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


def test_module_doc_comment_is_extracted():
    source = b"//! Widget module.\n\npub fn hello() -> i32 { 1 }\n"
    symbols = RustAnalyzer().parse("widget.rs", source)

    module = by_kind_name(symbols, SymbolKind.MODULE, "widget")
    assert module.docstring == "Widget module."


def test_struct_doc_comment_is_extracted():
    source = b"/// A widget struct.\npub struct Widget {}\n"
    symbols = RustAnalyzer().parse("widget.rs", source)

    widget = by_kind_name(symbols, SymbolKind.CLASS, "Widget")
    assert widget.docstring == "A widget struct."


def test_function_without_doc_comment_is_none():
    source = b"pub fn hello() -> i32 { 1 }\n"
    symbols = RustAnalyzer().parse("widget.rs", source)

    hello = by_kind_name(symbols, SymbolKind.FUNCTION, "hello")
    assert hello.docstring is None


def test_impl_method_doc_comment_is_extracted():
    source = (
        b"pub struct Widget {}\n\nimpl Widget {\n"
        b"    /// Says hello.\n    pub fn hello(&self) -> i32 { 1 }\n}\n"
    )
    symbols = RustAnalyzer().parse("widget.rs", source)

    hello = by_kind_name(symbols, SymbolKind.FUNCTION, "Widget.hello")
    assert hello.docstring == "Says hello."


def test_function_inside_a_nested_mod_is_captured():
    source = b"mod tests {\n    fn it_works() -> i32 { 1 }\n}\n"
    symbols = RustAnalyzer().parse("widget.rs", source)

    it_works = by_kind_name(symbols, SymbolKind.FUNCTION, "it_works")
    assert it_works.start_line == 2
