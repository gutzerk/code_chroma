"""Unit tests for `#`-line doc-comment extraction in RubyAnalyzer."""

from codechroma.analyzers.ruby_analyzer import RubyAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


def test_class_doc_comment_is_extracted():
    source = b"# A greeter class.\nclass Greeter\n  def hello\n    1\n  end\nend\n"
    symbols = RubyAnalyzer().parse("greeter.rb", source)

    greeter = by_kind_name(symbols, SymbolKind.CLASS, "Greeter")
    assert greeter.docstring == "A greeter class."


def test_first_method_doc_comment_is_extracted():
    """The doc comment sits before `body_statement`, not before the first `method` inside it."""
    source = b"class Greeter\n  # Says hello.\n  def hello\n    1\n  end\nend\n"
    symbols = RubyAnalyzer().parse("greeter.rb", source)

    hello = by_kind_name(symbols, SymbolKind.FUNCTION, "Greeter.hello")
    assert hello.docstring == "Says hello."


def test_method_without_doc_comment_is_none():
    source = b"class Greeter\n  def hello\n    1\n  end\nend\n"
    symbols = RubyAnalyzer().parse("greeter.rb", source)

    hello = by_kind_name(symbols, SymbolKind.FUNCTION, "Greeter.hello")
    assert hello.docstring is None
