"""Alone in its own folder, tied only to solo_b/b.py -- merges with it by aggregate traffic."""
from solo_b.b import helper_b


def helper_a():
    return helper_b()
