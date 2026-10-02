"""Maps a runtime frame (filename, qualname, line) back to the CodeChroma function node it ran."""

from __future__ import annotations

from bisect import bisect_right
from pathlib import Path

from codechroma.engine import GraphEngine
from codechroma.graph.models import SymbolKind


class FrameMapper:
    """Resolves live frames to node ids via a deterministic qualname index plus a line fallback."""

    def __init__(self, engine: GraphEngine, repo_root: str | Path):
        self._repo_root = Path(repo_root).resolve()
        self._by_qualname: dict[tuple[str, str], str] = {}
        self._by_line: dict[str, list[tuple[int, int, str]]] = {}
        self._line_starts: dict[str, list[int]] = {}
        self._build_index(engine)

    def _build_index(self, engine: GraphEngine) -> None:
        ranges: dict[str, list[tuple[int, int, str]]] = {}
        for symbol in engine.iter_symbols():
            if symbol.kind is not SymbolKind.FUNCTION:
                continue
            self._by_qualname[(symbol.file_path, symbol.qualified_name)] = symbol.id
            ranges.setdefault(symbol.file_path, []).append(
                (symbol.start_line, symbol.end_line, symbol.id)
            )
        for rel_path, entries in ranges.items():
            entries.sort(key=lambda item: (item[0], -item[1]))
            self._by_line[rel_path] = entries
            self._line_starts[rel_path] = [start for start, _, _ in entries]

    def to_rel_path(self, filename: str) -> str | None:
        """Repo-relative posix path for an absolute frame filename, or None if outside the repo."""
        try:
            absolute = Path(filename).resolve()
        except (OSError, ValueError):
            return None
        try:
            return absolute.relative_to(self._repo_root).as_posix()
        except ValueError:
            return None

    def resolve(self, filename: str, qualname: str, lineno: int) -> str | None:
        """Node id for an in-repo frame; None for external code or an unmatched frame."""
        rel_path = self.to_rel_path(filename)
        if rel_path is None:
            return None
        direct = self._by_qualname.get((rel_path, qualname))
        if direct is not None:
            return direct
        stripped = _strip_locals(qualname)
        if stripped != qualname:
            direct = self._by_qualname.get((rel_path, stripped))
            if direct is not None:
                return direct
        return self.resolve_by_line(rel_path, lineno)

    def resolve_by_line(self, rel_path: str, lineno: int) -> str | None:
        """Public entry point for callers with a repo-relative path but no runtime frame at all."""
        starts = self._line_starts.get(rel_path)
        if not starts:
            return None
        entries = self._by_line[rel_path]
        index = bisect_right(starts, lineno) - 1
        best: str | None = None
        while index >= 0:
            start, end, node_id = entries[index]
            if start <= lineno <= end:
                best = node_id
                break
            index -= 1
        return best


def _strip_locals(qualname: str) -> str:
    """Drops CPython's `<locals>` segments so nested-function qualnames match tree-sitter ones."""
    return ".".join(part for part in qualname.split(".") if part != "<locals>")
