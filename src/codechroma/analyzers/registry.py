"""LanguageAnalyzer protocol and extension-based registry (Strategy pattern)."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Protocol, runtime_checkable

from codechroma.graph.models import ClassShape, Symbol


@runtime_checkable
class LanguageAnalyzer(Protocol):
    """Parses a single source file into the Symbols it defines."""

    language: str

    # Read-only property: mutable Protocol attrs are invariant, so `(".py",)` could never satisfy.
    @property
    def extensions(self) -> Sequence[str]: ...

    def parse(self, file_path: str, source: bytes) -> list[Symbol]: ...

    def class_shapes(self, file_path: str, source: bytes) -> dict[str, ClassShape] | None:
        """Attribute/method shapes for pattern detection; None if this language extracts none."""
        ...

    def resolve_import(self, import_text: str, importer_file: str, repo_root: Path) -> str | None:
        """Repo-relative path an import resolves to on disk; None if unresolved/not local."""
        ...


class AnalyzerRegistry:
    """Selects a LanguageAnalyzer by file extension."""

    def __init__(self, analyzers: list[LanguageAnalyzer] | None = None):
        self._by_extension: dict[str, LanguageAnalyzer] = {}
        for analyzer in analyzers or []:
            self.register(analyzer)

    def register(self, analyzer: LanguageAnalyzer) -> None:
        for ext in analyzer.extensions:
            self._by_extension[ext] = analyzer

    def for_file(self, file_path: str) -> LanguageAnalyzer | None:
        return self._by_extension.get(Path(file_path).suffix)

    def supported_extensions(self) -> frozenset[str]:
        return frozenset(self._by_extension)

    @classmethod
    def with_defaults(cls) -> AnalyzerRegistry:
        from codechroma.analyzers.c_analyzer import CAnalyzer
        from codechroma.analyzers.cpp_analyzer import CppAnalyzer
        from codechroma.analyzers.csharp_analyzer import CSharpAnalyzer
        from codechroma.analyzers.go_analyzer import GoAnalyzer
        from codechroma.analyzers.java_analyzer import JavaAnalyzer
        from codechroma.analyzers.php_analyzer import PhpAnalyzer
        from codechroma.analyzers.python_analyzer import PythonAnalyzer
        from codechroma.analyzers.ruby_analyzer import RubyAnalyzer
        from codechroma.analyzers.rust_analyzer import RustAnalyzer
        from codechroma.analyzers.typescript_analyzer import TypeScriptAnalyzer
        from codechroma.analyzers.yaml_analyzer import YamlAnalyzer

        return cls([
            PythonAnalyzer(), TypeScriptAnalyzer(), GoAnalyzer(), JavaAnalyzer(),
            CSharpAnalyzer(), RustAnalyzer(), PhpAnalyzer(), RubyAnalyzer(), CAnalyzer(),
            CppAnalyzer(), YamlAnalyzer(),
        ])
