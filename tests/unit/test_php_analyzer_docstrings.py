"""Unit tests for PHPDoc `/** */` doc extraction in PhpAnalyzer."""

from codechroma.analyzers.php_analyzer import PhpAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


def test_class_doc_comment_is_extracted():
    source = (
        b"<?php\n/**\n * A greeter class.\n */\nclass Greeter {\n"
        b"    public function hello() { return 1; }\n}\n"
    )
    symbols = PhpAnalyzer().parse("Greeter.php", source)

    greeter = by_kind_name(symbols, SymbolKind.CLASS, "Greeter")
    assert greeter.docstring == "A greeter class."


def test_method_doc_comment_is_extracted():
    source = (
        b"<?php\nclass Greeter {\n    /**\n     * Says hello.\n     */\n"
        b"    public function hello() { return 1; }\n}\n"
    )
    symbols = PhpAnalyzer().parse("Greeter.php", source)

    hello = by_kind_name(symbols, SymbolKind.FUNCTION, "Greeter.hello")
    assert hello.docstring == "Says hello."


def test_method_without_doc_comment_is_none():
    source = b"<?php\nclass Greeter {\n    public function hello() { return 1; }\n}\n"
    symbols = PhpAnalyzer().parse("Greeter.php", source)

    hello = by_kind_name(symbols, SymbolKind.FUNCTION, "Greeter.hello")
    assert hello.docstring is None


def test_trait_method_is_attached_to_the_trait():
    source = b"<?php\ntrait Greetable {\n    public function hello() { return 1; }\n}\n"
    symbols = PhpAnalyzer().parse("Greetable.php", source)

    hello = by_kind_name(symbols, SymbolKind.FUNCTION, "Greetable.hello")
    assert hello.parent_symbol_id == by_kind_name(symbols, SymbolKind.CLASS, "Greetable").id
