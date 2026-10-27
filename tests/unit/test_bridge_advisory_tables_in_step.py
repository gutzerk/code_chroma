"""The edge/message-kind tables live in three copies; this fails when one drifts from the others."""

import importlib.util
import re
import sys
from pathlib import Path

from codechroma.bridge import diagram_diagnostics as bridge

ROOT = Path(__file__).resolve().parents[2]
_NAMES = (
    "MESSAGE_KINDS", "EDGE_KINDS", "EDGE_KIND_ALIASES", "_PLAIN_EDGE_KINDS", "_STRUCTURAL_KINDS",
)


def _checker():
    path = ROOT / "skills" / "codechroma-draw-diagram" / "scripts" / "check_diagram.py"
    spec = importlib.util.spec_from_file_location("check_diagram_tables", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_diagram_tables"] = module
    spec.loader.exec_module(module)
    return module


def _pascal(name: str) -> str:
    return "".join(part.title() for part in name.strip("_").split("_"))


def _csharp_array(source: str, name: str) -> tuple[str, ...]:
    body = re.search(rf"string\[\] {name} =\s*\[(.*?)\];", source, re.DOTALL).group(1)
    return tuple(re.findall(r'"([^"]*)"', body))


def test_the_checker_and_the_bridge_share_the_same_kind_tables():
    checker = _checker()

    pairs = [(getattr(checker, name), getattr(bridge, name)) for name in _NAMES]

    assert len(pairs) == len(_NAMES)
    assert all(left == right for left, right in pairs)


def test_the_checker_and_the_bridge_share_the_same_wording_regexes():
    checker = _checker()

    same = (
        checker._SPAWN_WORDS.pattern == bridge._SPAWN_WORDS.pattern
        and checker._DATA_WORDS.pattern == bridge._DATA_WORDS.pattern
    )

    assert same


def test_the_csharp_bridge_shares_the_same_kind_tables():
    path = ROOT / "dotnet/CodeChroma.Bridge/Diagrams/DiagramResolver.cs"
    source = path.read_text(encoding="utf-8")

    tables = {name: _csharp_array(source, _pascal(name)) for name in _NAMES}

    assert tables == {name: getattr(bridge, name) for name in _NAMES}
