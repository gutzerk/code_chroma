"""The terminal socket's `?rows=&cols=` query: the window's measured size before the first paint."""

from types import SimpleNamespace

import pytest

from codechroma.terminal.server import _query_size


@pytest.mark.parametrize(
    ("params", "size"),
    [
        ({"rows": "30", "cols": "100"}, (30, 100)),
        ({"rows": "0", "cols": "5000"}, (1, 1000)),
        ({"rows": "30"}, None),
        ({"rows": "x", "cols": "100"}, None),
        ({}, None),
    ],
)
def test_the_query_size_is_read_and_clamped(params, size):
    socket = SimpleNamespace(query_params=params)

    result = _query_size(socket)

    assert result == size
