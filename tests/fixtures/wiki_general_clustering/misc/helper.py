"""Alone in its own folder -- joins billing/ via call-graph majority, not a folder default."""
from billing.service import charge


def do_it():
    return charge(1)
