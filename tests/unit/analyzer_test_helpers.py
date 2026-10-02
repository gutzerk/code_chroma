"""Shared lookup helper for the per-language docstring-extraction test suites."""


def by_kind_name(symbols, kind, qualified_name):
    return next(s for s in symbols if s.kind == kind and s.qualified_name == qualified_name)
