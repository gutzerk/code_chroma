"""YAML LanguageAnalyzer -- GitHub Actions get dialect names, else a generic parse."""

from __future__ import annotations

from pathlib import Path

import yaml
from yaml.nodes import MappingNode, Node, ScalarNode, SequenceNode

from codechroma.analyzers.tree_sitter_common import module_dotted_path, no_import_resolution
from codechroma.graph.models import ClassShape, Symbol, SymbolKind

_ACTION_FILENAMES = ("action.yml", "action.yaml")


def _scalar_text(node: Node | None) -> str | None:
    """The trimmed string value of a scalar node, or None if absent/blank/not scalar."""
    if not isinstance(node, ScalarNode):
        return None
    text = node.value.strip()
    return text or None


def _named_entries(node: Node | None) -> list[tuple[str, Node, Node]]:
    """(key_text, key_node, value_node) per scalar-keyed entry of a mapping; [] otherwise."""
    if not isinstance(node, MappingNode):
        return []
    return [(key.value, key, value) for key, value in node.value if isinstance(key, ScalarNode)]


def _field(node: Node | None, name: str) -> Node | None:
    """The value node for a top-level mapping key (last entry wins on a duplicate), or None."""
    matches = [value for key, _, value in _named_entries(node) if key == name]
    return matches[-1] if matches else None


def _is_list_of_mappings(node: Node | None) -> bool:
    """True iff `node` is a non-empty sequence whose every element is itself a mapping."""
    return isinstance(node, SequenceNode) and bool(node.value) and all(
        isinstance(item, MappingNode) for item in node.value
    )


def _span(start: Node, end: Node | None = None) -> tuple[int, int]:
    """1-based (start_line, end_line); `end` defaults to `start` for a single-node span."""
    tail = end if end is not None else start
    return start.start_mark.line + 1, tail.end_mark.line + 1


def _module_symbol(file_path: str, root: Node | None, source: bytes) -> Symbol:
    dotted = module_dotted_path(file_path)
    start_line, end_line = _span(root) if root is not None else (1, max(1, source.count(b"\n") + 1))
    return Symbol(
        id=f"{file_path}::module::{dotted}",
        file_path=file_path,
        kind=SymbolKind.MODULE,
        name=dotted.rsplit(".", 1)[-1] if dotted else file_path,
        qualified_name=dotted,
        start_line=start_line,
        end_line=end_line,
        language="yaml",
    )


def _class_symbol(
    file_path: str,
    qualname: str,
    name: str,
    span: tuple[int, int],
    parent_id: str,
    docstring: str | None = None,
) -> Symbol:
    start_line, end_line = span
    return Symbol(
        id=f"{file_path}::class::{qualname}",
        file_path=file_path,
        kind=SymbolKind.CLASS,
        name=name,
        qualified_name=qualname,
        start_line=start_line,
        end_line=end_line,
        language="yaml",
        parent_symbol_id=parent_id,
        docstring=docstring,
    )


def _function_symbol(
    file_path: str, qualname: str, name: str, span: tuple[int, int], parent_id: str
) -> Symbol:
    start_line, end_line = span
    return Symbol(
        id=f"{file_path}::function::{qualname}",
        file_path=file_path,
        kind=SymbolKind.FUNCTION,
        name=name,
        qualified_name=qualname,
        start_line=start_line,
        end_line=end_line,
        language="yaml",
        parent_symbol_id=parent_id,
    )


def _step_name(step: MappingNode, index: int) -> str:
    """Step display name: own `name:` -> `uses:` -> first non-blank line of `run:` -> `Step N`."""
    name = _scalar_text(_field(step, "name"))
    if name:
        return name
    uses = _scalar_text(_field(step, "uses"))
    if uses:
        return uses
    run = _field(step, "run")
    if isinstance(run, ScalarNode):
        first_line = next((line.strip() for line in run.value.splitlines() if line.strip()), "")
        if first_line:
            return first_line
    return f"Step {index}"


def _mapping_sequence_symbols(
    file_path: str,
    seq: SequenceNode,
    parent_qualname: str,
    parent_id: str,
    label: str,
    name_of,
) -> list[Symbol]:
    """One FUNCTION per mapping element of `seq`, indexed for a qualname stable across renames."""
    symbols: list[Symbol] = []
    for index, item in enumerate(seq.value, start=1):
        if not isinstance(item, MappingNode):
            continue
        qualname = f"{parent_qualname}.{label}_{index}"
        symbols.append(
            _function_symbol(file_path, qualname, name_of(item, index), _span(item), parent_id)
        )
    return symbols


def _step_symbols(
    file_path: str, steps: SequenceNode, parent_qualname: str, parent_id: str
) -> list[Symbol]:
    return _mapping_sequence_symbols(
        file_path, steps, parent_qualname, parent_id, "step", _step_name
    )


def _parse_workflow(
    file_path: str, jobs: MappingNode, module_id: str, qual_prefix: str = ""
) -> list[Symbol]:
    """One CLASS per `jobs.<id>`, one FUNCTION per step of that job's `steps:`."""
    symbols: list[Symbol] = []
    for job_id, job_key, job_value in _named_entries(jobs):
        if not isinstance(job_value, MappingNode):
            continue
        qualname = f"{qual_prefix}{job_id}"
        display_name = _scalar_text(_field(job_value, "name")) or job_id
        class_sym = _class_symbol(
            file_path, qualname, display_name, _span(job_key, job_value), module_id
        )
        symbols.append(class_sym)
        steps = _field(job_value, "steps")
        if isinstance(steps, SequenceNode):
            symbols.extend(_step_symbols(file_path, steps, qualname, class_sym.id))
    return symbols


def _is_action_file(file_path: str) -> bool:
    return Path(file_path).name in _ACTION_FILENAMES


def _parse_action(
    file_path: str, root: MappingNode, module_id: str, qual_prefix: str = ""
) -> list[Symbol]:
    """One CLASS for the whole file; if `runs.using == composite`, one FUNCTION per step."""
    display_name = _scalar_text(_field(root, "name")) or Path(file_path).parent.name
    qualname = f"{qual_prefix}{display_name}"
    docstring = _scalar_text(_field(root, "description"))
    class_sym = _class_symbol(
        file_path, qualname, display_name, _span(root), module_id, docstring
    )
    symbols: list[Symbol] = [class_sym]
    runs = _field(root, "runs")
    if _scalar_text(_field(runs, "using")) == "composite":
        steps = _field(runs, "steps")
        if isinstance(steps, SequenceNode):
            symbols.extend(_step_symbols(file_path, steps, qualname, class_sym.id))
    return symbols


def _item_name(item: MappingNode, index: int) -> str:
    """Generic-list display name: own `name:` -> `id:` -> `item N`."""
    name = _scalar_text(_field(item, "name")) or _scalar_text(_field(item, "id"))
    return name or f"item {index}"


def _generic_items(
    file_path: str, seq: SequenceNode, parent_qualname: str, parent_id: str
) -> list[Symbol]:
    return _mapping_sequence_symbols(file_path, seq, parent_qualname, parent_id, "item", _item_name)


def _parse_generic(
    file_path: str, root: Node, module_id: str, qual_prefix: str = ""
) -> list[Symbol]:
    """One CLASS per root key whose value is a mapping or a list of mappings (no other dialect)."""
    symbols: list[Symbol] = []
    for key_text, key_node, value in _named_entries(root):
        list_of_mappings = _is_list_of_mappings(value)
        if not (isinstance(value, MappingNode) or list_of_mappings):
            continue
        qualname = f"{qual_prefix}{key_text}"
        class_sym = _class_symbol(file_path, qualname, key_text, _span(key_node, value), module_id)
        symbols.append(class_sym)
        if list_of_mappings and isinstance(value, SequenceNode):
            symbols.extend(_generic_items(file_path, value, qualname, class_sym.id))
    return symbols


class YamlAnalyzer:
    """LanguageAnalyzer for YAML: GitHub Actions get dialect names, else a generic fallback."""

    language = "yaml"
    extensions = (".yml", ".yaml")

    def class_shapes(self, file_path: str, source: bytes) -> dict[str, ClassShape] | None:
        """No pattern-detection shapes for config YAML -- same as TypeScript and epic 031."""
        return None

    resolve_import = staticmethod(no_import_resolution)

    def parse(self, file_path: str, source: bytes) -> list[Symbol]:
        """Walks pyyaml's `compose_all()` tree, one document at a time (see engine.md for why)."""
        # compose_all(), not compose(): a `---`-separated multi-doc k8s manifest has >1 root node.
        documents = [doc for doc in yaml.compose_all(source) if doc is not None]
        single = documents[0] if len(documents) == 1 else None
        module = _module_symbol(file_path, single, source)
        symbols: list[Symbol] = [module]

        for index, root in enumerate(documents, start=1):
            qual_prefix = f"doc{index}." if len(documents) > 1 else ""
            jobs = _field(root, "jobs")
            if isinstance(jobs, MappingNode):
                symbols.extend(_parse_workflow(file_path, jobs, module.id, qual_prefix))
            elif (
                isinstance(root, MappingNode)
                and _is_action_file(file_path)
                and _field(root, "runs") is not None
            ):
                symbols.extend(_parse_action(file_path, root, module.id, qual_prefix))
            else:
                symbols.extend(_parse_generic(file_path, root, module.id, qual_prefix))
        return symbols
