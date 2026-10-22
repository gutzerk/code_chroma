"""Contract test: every analyzer's first parsed symbol is the file's MODULE symbol."""

import pytest

from codechroma.graph.models import SymbolKind
from tests.contract.test_language_analyzer_contract import ANALYZERS, SNIPPETS


@pytest.mark.parametrize("analyzer", ANALYZERS, ids=lambda a: a.language)
def test_first_symbol_is_the_module(analyzer):
    file_path = f"pkg/sample{analyzer.extensions[0]}"

    symbols = analyzer.parse(file_path, SNIPPETS[analyzer.language])

    assert symbols[0].kind == SymbolKind.MODULE
