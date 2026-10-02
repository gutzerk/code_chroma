"""Assembles the hierarchy as a 1:1 mirror of the real directory tree, then decomposes files.

Each real directory becomes a folder node (top-level dir -> System, any nested dir -> Pillar), each
file a Component under its own directory, and every file is decomposed into
Service->Function->LogicBlock->Code from its parsed symbols. Names are the raw on-disk directory and
file names; structure follows the filesystem, not code references.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from codechroma.graph.models import HierarchyLevel, HierarchyNode, Symbol, SymbolKind

if TYPE_CHECKING:
    from codechroma.analyzers.registry import AnalyzerRegistry

_CONTROL_FLOW_LABELS = {
    "if_statement": "Conditional Branch",
    "for_statement": "Loop",
    "for_in_statement": "Loop",
    "while_statement": "Loop",
    "do_statement": "Loop",
    "try_statement": "Error Handling",
    "with_statement": "Context Block",
    "switch_statement": "Conditional Branch",
}

# Public: also consumed by bridge/wiki_general_agent.py's "is there real code" guard.
DOC_EXTENSIONS = {".md", ".rst", ".txt", ".adoc"}


class GraphBuilder:
    """Builds the hierarchy from a repository's parsed (or unparseable) files."""

    def build(
        self,
        symbols_by_file: dict[str, list[Symbol] | None],
        repo_root: Path | None = None,
        registry: AnalyzerRegistry | None = None,
    ) -> tuple[list[HierarchyNode], dict[str, Symbol]]:
        parsed_files = {fp: syms for fp, syms in symbols_by_file.items() if syms is not None}
        placeholder_files = [fp for fp, syms in symbols_by_file.items() if syms is None]

        all_symbols: dict[str, Symbol] = {}
        module_by_file: dict[str, Symbol] = {}
        toplevel_by_file: dict[str, list[Symbol]] = {}
        for file_path, syms in parsed_files.items():
            toplevel_by_file[file_path] = []
            for symbol in syms:
                all_symbols[symbol.id] = symbol
                if symbol.kind == SymbolKind.MODULE:
                    module_by_file[file_path] = symbol
        for file_path, syms in parsed_files.items():
            module = module_by_file[file_path]
            for symbol in syms:
                is_top_level = symbol.parent_symbol_id == module.id
                if symbol.kind in (SymbolKind.CLASS, SymbolKind.FUNCTION) and is_top_level:
                    toplevel_by_file[file_path].append(symbol)

        symbol_edges = self._resolve_symbol_edges(
            all_symbols, module_by_file, toplevel_by_file, repo_root, registry
        )

        nodes: dict[str, HierarchyNode] = {}
        for file_path, syms in parsed_files.items():
            component_id = self._add_component(nodes, file_path)
            self._build_file_hierarchy(
                nodes, file_path, syms, toplevel_by_file[file_path], component_id
            )

        for file_path in placeholder_files:
            self._add_component(nodes, file_path)

        self._compute_doc_only(nodes)
        self._apply_dependency_edges(nodes, symbol_edges)

        return list(nodes.values()), all_symbols

    def _ensure_dir_chain(self, nodes: dict[str, HierarchyNode], file_path: str) -> str | None:
        """Creates a folder node per ancestor directory of file_path; returns the nearest one."""
        parts = Path(file_path).parts[:-1]
        parent_id: str | None = None
        path_so_far = ""
        for depth, part in enumerate(parts):
            path_so_far = part if depth == 0 else f"{path_so_far}/{part}"
            dir_id = f"dir::{path_so_far}"
            if dir_id not in nodes:
                level = HierarchyLevel.SYSTEM if depth == 0 else HierarchyLevel.PILLAR
                nodes[dir_id] = HierarchyNode(
                    id=dir_id,
                    name=part,
                    level=level,
                    parent_ids=[parent_id] if parent_id else [],
                    source_path=path_so_far,
                )
            parent_id = dir_id
        return parent_id

    def _compute_doc_only(self, nodes: dict[str, HierarchyNode]) -> None:
        """Marks each folder node doc_only=True iff its whole subtree is only doc files."""
        children_by_parent: dict[str, list[str]] = {}
        for node in nodes.values():
            for parent_id in node.parent_ids:
                children_by_parent.setdefault(parent_id, []).append(node.id)

        dir_nodes = [
            node
            for node in nodes.values()
            if node.level in (HierarchyLevel.SYSTEM, HierarchyLevel.PILLAR)
        ]
        dir_nodes.sort(key=lambda node: (node.source_path or "").count("/"), reverse=True)

        for dir_node in dir_nodes:
            is_doc_only = True
            for child_id in children_by_parent.get(dir_node.id, []):
                child = nodes[child_id]
                if child.level == HierarchyLevel.COMPONENT:
                    suffix = Path(child.source_path or "").suffix.lower()
                    child_is_doc = suffix in DOC_EXTENSIONS
                elif child.level in (HierarchyLevel.SYSTEM, HierarchyLevel.PILLAR):
                    child_is_doc = child.doc_only
                else:
                    continue
                if not child_is_doc:
                    is_doc_only = False
                    break
            dir_node.doc_only = is_doc_only

    def _resolve_symbol_edges(
        self,
        all_symbols: dict[str, Symbol],
        module_by_file: dict[str, Symbol],
        toplevel_by_file: dict[str, list[Symbol]],
        repo_root: Path | None,
        registry: AnalyzerRegistry | None,
    ) -> dict[str, set[str]]:
        name_index: dict[str, dict[str, Symbol]] = {
            file_path: {s.name: s for s in syms} for file_path, syms in toplevel_by_file.items()
        }
        # Go's import unit is a directory, not a file -- a dir's files pool their top-level names.
        files_by_dir: dict[str, list[str]] = {}
        for file_path in toplevel_by_file:
            files_by_dir.setdefault(Path(file_path).parent.as_posix(), []).append(file_path)
        dir_name_index: dict[str, dict[str, Symbol]] = {}
        for dir_path, files in files_by_dir.items():
            merged: dict[str, Symbol] = {}
            for file_path in files:
                merged.update(name_index.get(file_path, {}))
            dir_name_index[dir_path] = merged

        def resolve_target_index(
            importer_file: str, target_dotted: str
        ) -> dict[str, Symbol] | None:
            if repo_root is None or registry is None:
                return None
            analyzer = registry.for_file(importer_file)
            if analyzer is None:
                return None
            candidate = analyzer.resolve_import(target_dotted, importer_file, repo_root)
            if candidate is None:
                return None
            return name_index.get(candidate, dir_name_index.get(candidate))

        edges: dict[str, set[str]] = {}
        for symbol in all_symbols.values():
            if symbol.kind not in (SymbolKind.CLASS, SymbolKind.FUNCTION):
                continue
            targets: set[str] = set()
            module = module_by_file.get(symbol.file_path)
            for ref_name in symbol.references:
                target = name_index.get(symbol.file_path, {}).get(ref_name)
                if target is None and module is not None and ref_name in module.imports:
                    target_index = resolve_target_index(symbol.file_path, module.imports[ref_name])
                    if target_index is not None:
                        target = target_index.get(ref_name)
                if target is not None and target.id != symbol.id:
                    targets.add(target.id)
            for qualifier, name in symbol.qualified_references:
                if module is None or qualifier not in module.imports:
                    continue
                target_index = resolve_target_index(symbol.file_path, module.imports[qualifier])
                if target_index is None:
                    continue
                target = target_index.get(name)
                if target is not None and target.id != symbol.id:
                    targets.add(target.id)
            if targets:
                edges[symbol.id] = targets
        return edges

    def _add_component(self, nodes: dict[str, HierarchyNode], file_path: str) -> str:
        """Also covers unparseable/analyzer-less files, which get an identical childless node."""
        parent_dir_id = self._ensure_dir_chain(nodes, file_path)
        component_id = f"component::{file_path}"
        nodes[component_id] = HierarchyNode(
            id=component_id,
            name=Path(file_path).name,
            level=HierarchyLevel.COMPONENT,
            parent_ids=[parent_dir_id] if parent_dir_id else [],
            source_path=file_path,
        )
        return component_id

    def _build_file_hierarchy(
        self,
        nodes: dict[str, HierarchyNode],
        file_path: str,
        syms: list[Symbol],
        top_level: list[Symbol],
        component_id: str,
    ) -> None:
        for cls in (s for s in top_level if s.kind == SymbolKind.CLASS):
            service_id = cls.id
            nodes[service_id] = HierarchyNode(
                id=service_id,
                name=cls.name,
                level=HierarchyLevel.SERVICE,
                parent_ids=[component_id],
                source_path=file_path,
            )
            methods = [
                s for s in syms if s.kind == SymbolKind.FUNCTION and s.parent_symbol_id == cls.id
            ]
            for method in methods:
                self._build_function_node(nodes, method, service_id, file_path)

        bare_functions = [s for s in top_level if s.kind == SymbolKind.FUNCTION]
        if bare_functions:
            service_id = f"service::{file_path}::functions"
            nodes[service_id] = HierarchyNode(
                id=service_id,
                name="Module Functions",
                level=HierarchyLevel.SERVICE,
                parent_ids=[component_id],
                source_path=file_path,
            )
            for func in bare_functions:
                self._build_function_node(nodes, func, service_id, file_path)

    def _build_function_node(
        self,
        nodes: dict[str, HierarchyNode],
        func_symbol: Symbol,
        parent_service_id: str,
        file_path: str,
    ) -> None:
        function_id = func_symbol.id
        nodes[function_id] = HierarchyNode(
            id=function_id,
            name=func_symbol.name,
            level=HierarchyLevel.FUNCTION,
            parent_ids=[parent_service_id],
            source_path=file_path,
        )

        for index, (label, start, end) in enumerate(self._extract_logic_blocks(func_symbol)):
            block_id = f"logicblock::{function_id}::{index}"
            span = f"{file_path}:{start}-{end}"
            nodes[block_id] = HierarchyNode(
                id=block_id,
                name=label,
                level=HierarchyLevel.LOGIC_BLOCK,
                parent_ids=[function_id],
                source_path=span,
            )
            code_id = f"code::{block_id}"
            nodes[code_id] = HierarchyNode(
                id=code_id,
                name=span,
                level=HierarchyLevel.CODE,
                parent_ids=[block_id],
                source_path=span,
            )

    def _extract_logic_blocks(self, func_symbol: Symbol) -> list[tuple[str, int, int]]:
        statements = func_symbol.body_statements
        if not statements:
            return [("Body", func_symbol.start_line, func_symbol.end_line)]

        raw_blocks: list[tuple[str | None, int, int]] = []
        current: list[tuple[int, int]] = []
        for stmt_type, start, end in statements:
            control_label = _CONTROL_FLOW_LABELS.get(stmt_type)
            if control_label is not None:
                if current:
                    raw_blocks.append((None, current[0][0], current[-1][1]))
                    current = []
                raw_blocks.append((control_label, start, end))
            else:
                current.append((start, end))
        if current:
            raw_blocks.append((None, current[0][0], current[-1][1]))

        blocks: list[tuple[str, int, int]] = []
        step_num = 0
        for label, start, end in raw_blocks:
            if label is None:
                step_num += 1
                label = f"Step {step_num}"
            blocks.append((label, start, end))
        return blocks

    def _apply_dependency_edges(
        self,
        nodes: dict[str, HierarchyNode],
        symbol_edges: dict[str, set[str]],
    ) -> None:
        for symbol_id, targets in symbol_edges.items():
            if symbol_id not in nodes:
                continue
            dep_ids = {t for t in targets if t in nodes}
            if dep_ids:
                nodes[symbol_id].depends_on_ids = sorted(dep_ids)
