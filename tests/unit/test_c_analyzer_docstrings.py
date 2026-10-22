"""Unit tests for Doxygen `/** */`/`//` doc extraction in CAnalyzer."""

import pytest

from codechroma.analyzers.c_analyzer import CAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name


@pytest.mark.parametrize(
    "source",
    [
        b"/**\n * Adds two numbers.\n */\nint add(int a, int b) {\n    return a + b;\n}\n",
        b"// Adds two numbers.\nint add(int a, int b) {\n    return a + b;\n}\n",
    ],
    ids=["block-comment", "line-comment"],
)
def test_doc_comment_is_extracted(source):
    symbols = CAnalyzer().parse("math.c", source)

    add = by_kind_name(symbols, SymbolKind.FUNCTION, "add")
    assert add.docstring == "Adds two numbers."


def test_function_without_doc_comment_is_none():
    source = b"int add(int a, int b) {\n    return a + b;\n}\n"
    symbols = CAnalyzer().parse("math.c", source)

    add = by_kind_name(symbols, SymbolKind.FUNCTION, "add")
    assert add.docstring is None
