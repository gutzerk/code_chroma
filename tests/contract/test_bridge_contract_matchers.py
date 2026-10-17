"""The contract's own matcher semantics -- mirrored by ContractMatchersTests.cs in the C# suite."""

import pytest

from tests.contract.bridge_contract import check_failures, json_matches, select

DOC = {"nodes": [{"id": "a", "n": 1}, {"id": "b", "n": 2}], "x": {"source": "s"}, "k-1": True}


@pytest.mark.parametrize(
    ("expected", "actual", "matches"),
    [
        ({"a": 1}, {"a": 1}, True),
        ({"a": 1}, {"a": 1, "b": 2}, False),
        ([1, 2], [1, 2, 3], False),
        ({"$any": True}, [1], True),
        ({"a": {"$any": True}}, {"a": None}, True),
        (True, 1, False),
        (None, None, True),
        ("$REPO/x", "C:\\r\\x", True),
        ("a", "b", False),
    ],
)
def test_json_matches(expected, actual, matches):
    assert json_matches(expected, actual, "C:/r") is matches


@pytest.mark.parametrize(
    ("path", "values", "fanned"),
    [
        ("$.x.source", ["s"], False),
        ("$.nodes[*].id", ["a", "b"], True),
        ("$.nodes[id=b].n", [2], True),
        ("$.nodes[1].id", ["b"], False),
        ("$..source", ["s"], True),
        ("$['k-1']", [True], False),
        ("$.nope", [], False),
    ],
)
def test_select(path, values, fanned):
    assert select(DOC, path) == (values, fanned)


@pytest.mark.parametrize(
    ("check", "fails"),
    [
        ({"path": "$.nodes[*].id", "equals": ["a", "b"]}, False),
        ({"path": "$.nodes[*].id", "contains": "c"}, True),
        ({"path": "$.nodes[*]", "count": 2}, False),
        ({"path": "$..nope", "absent": True}, False),
        ({"path": "$.x", "absent": True}, True),
        ({"path": "$.x", "type": "object"}, False),
        ({"path": "$.nope", "equals": 1}, True),
    ],
)
def test_check_failures(check, fails):
    assert bool(check_failures([check], DOC, "C:/r")) is fails
