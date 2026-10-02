"""Tree-sitter helpers every LanguageAnalyzer shares, parameterized by per-language node types.

The three analyzers differ only in which grammar they load and what their grammar calls a call
node, a callee's trailing segment, and a function body's statement list. Everything else -- reading
a node's text, walking for calls, splitting a body into statements, and building the file's MODULE
symbol -- is identical, so it lives here rather than being copied per language.
"""

from __future__ import annotations

import inspect
import posixpath
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from tree_sitter import Language, Node, Parser

from codechroma.graph.models import MethodShape, Symbol, SymbolKind


@dataclass(frozen=True, slots=True)
class CallSpec:
    """Names this grammar uses for a call node and for a qualified callee's trailing segment."""

    call_type: str
    member_type: str
    member_field: str
    # Field holding the base of a qualified call (e.g. `object`/`operand`); None skips qualifiers.
    object_field: str | None = None


@dataclass(frozen=True, slots=True)
class AttributeSpec:
    """Node type names this grammar uses for the shapes `collect_attribute_usage` looks for."""

    assignment_type: str
    subscript_type: str
    attribute_type: str
    call_type: str
    for_type: str
    comparison_type: str
    none_type: str
    self_names: tuple[str, ...] = ("self",)
    cls_names: tuple[str, ...] = ("cls",)


def node_text(node: Node, source: bytes) -> str:
    """The raw source slice a node spans, decoded leniently so bad bytes can't abort a parse."""
    return source[node.start_byte : node.end_byte].decode("utf8", errors="replace")


def module_dotted_path(file_path: str, strip_init: bool = False) -> str:
    """Dotted module name for a file path; `strip_init` drops a trailing `__init__` (Python)."""
    parts = list(Path(file_path.replace("\\", "/")).with_suffix("").parts)
    if strip_init and parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def confined_relpath(relative_posix: str) -> str | None:
    """Normalized `relative_posix`, or None if it climbs above the root it's relative to."""
    normalized = posixpath.normpath(relative_posix)
    return None if normalized == ".." or normalized.startswith("../") else normalized


def no_import_resolution(import_text: str, importer_file: str, repo_root: Path) -> str | None:
    """Shared `resolve_import` for languages with no import-graph signal yet -- always None."""
    return None


def find_ancestor_file(start_dir: Path, repo_root: Path, filename: str) -> Path | None:
    """Nearest `filename` at or above `start_dir`, never searching above `repo_root`."""
    repo_root = repo_root.resolve()
    current = start_dir.resolve()
    if current != repo_root and repo_root not in current.parents:
        current = repo_root
    while True:
        candidate = current / filename
        if candidate.is_file():
            return candidate
        if current == repo_root:
            return None
        current = current.parent


def call_target_name(
    call_node: Node, source: bytes, spec: CallSpec
) -> tuple[str | None, str] | None:
    """(qualifier, name) for what a call invokes -- bare identifier gives qualifier=None."""
    target = call_node.child_by_field_name("function")
    if target is None:
        return None
    if target.type == "identifier":
        return None, node_text(target, source)
    if target.type == spec.member_type:
        segment = target.child_by_field_name(spec.member_field)
        if segment is None:
            return None
        qualifier = None
        if spec.object_field is not None:
            obj = target.child_by_field_name(spec.object_field)
            if obj is not None:
                qualifier = node_text(obj, source)
        return qualifier, node_text(segment, source)
    return None


def collect_calls(
    node: Node,
    source: bytes,
    out: list[str],
    spec: CallSpec,
    qualified_out: list[tuple[str, str]] | None = None,
) -> None:
    """Appends the name of every call in `node`'s subtree; also fills `qualified_out` if given."""
    if node.type == spec.call_type:
        result = call_target_name(node, source, spec)
        if result is not None:
            qualifier, name = result
            out.append(name)
            if qualifier is not None and qualified_out is not None:
                qualified_out.append((qualifier, name))
    for child in node.children:
        collect_calls(child, source, out, spec, qualified_out)


def _attr_root_and_name(node: Node, source: bytes, spec: AttributeSpec) -> tuple[str, str] | None:
    """(base, name) if `node` is `<base>.<name>` and `base` is a bare self/cls id, else None."""
    if node.type != spec.attribute_type:
        return None
    obj = node.child_by_field_name("object")
    attr = node.child_by_field_name("attribute")
    if obj is None or attr is None or obj.type != "identifier":
        return None
    base_name = node_text(obj, source)
    if base_name not in spec.self_names and base_name not in spec.cls_names:
        return None
    return base_name, node_text(attr, source)


def _handle_assignment_target(
    left: Node | None, source: bytes, shape: MethodShape, spec: AttributeSpec
) -> None:
    if left is None:
        return
    if left.type == spec.subscript_type:
        base = left.child_by_field_name("value")
        info = _attr_root_and_name(base, source, spec) if base is not None else None
        if info is not None and info[0] in spec.self_names:
            shape.writes_dict_attrs.append(info[1])
        return
    info = _attr_root_and_name(left, source, spec)
    if info is not None and info[0] in spec.cls_names:
        shape.sets_class_attr.append(info[1])


def _handle_attribute_call(
    node: Node, source: bytes, shape: MethodShape, spec: AttributeSpec
) -> None:
    func = node.child_by_field_name("function")
    if func is None or func.type != spec.attribute_type:
        return
    obj = func.child_by_field_name("object")
    method = func.child_by_field_name("attribute")
    if obj is None or method is None:
        return
    info = _attr_root_and_name(obj, source, spec)
    if info is None or info[0] not in spec.self_names:
        return
    attr_name = info[1]
    method_name = node_text(method, source)
    shape.calls_on_attr.setdefault(attr_name, []).append(method_name)
    if method_name == "append":
        shape.appends_list_attrs.append(attr_name)
    elif method_name == "get":
        shape.reads_dict_attrs.append(attr_name)


def _handle_subscript_read(
    node: Node, source: bytes, shape: MethodShape, spec: AttributeSpec
) -> None:
    base = node.child_by_field_name("value")
    if base is None:
        return
    info = _attr_root_and_name(base, source, spec)
    if info is not None and info[0] in spec.self_names:
        shape.reads_dict_attrs.append(info[1])


def _handle_for_target(node: Node, source: bytes, shape: MethodShape, spec: AttributeSpec) -> None:
    right = node.child_by_field_name("right")
    if right is None:
        return
    info = _attr_root_and_name(right, source, spec)
    if info is not None and info[0] in spec.self_names:
        shape.iterates_attrs.append(info[1])


def _handle_none_check(node: Node, source: bytes, shape: MethodShape, spec: AttributeSpec) -> None:
    operands = [child for child in node.children if child.is_named]
    if len(operands) != 2:
        return
    first, second = operands
    if first.type == spec.none_type:
        none_side: Node | None = first
    elif second.type == spec.none_type:
        none_side = second
    else:
        none_side = None
    if none_side is None:
        return
    other_side = second if none_side is first else first
    info = _attr_root_and_name(other_side, source, spec)
    if info is not None and info[0] in spec.cls_names:
        shape.checks_none_class_attr.append(info[1])


def collect_attribute_usage(
    node: Node, source: bytes, shape: MethodShape, spec: AttributeSpec
) -> None:
    """Fills `shape` from every self/cls attribute read/write/call in a method body subtree."""
    if node.type == spec.assignment_type:
        left = node.child_by_field_name("left")
        right = node.child_by_field_name("right")
        _handle_assignment_target(left, source, shape, spec)
        if right is not None:
            collect_attribute_usage(right, source, shape, spec)
        return
    if node.type == spec.call_type:
        _handle_attribute_call(node, source, shape, spec)
    elif node.type == spec.subscript_type:
        _handle_subscript_read(node, source, shape, spec)
    elif node.type == spec.for_type:
        _handle_for_target(node, source, shape, spec)
    elif node.type == spec.comparison_type:
        _handle_none_check(node, source, shape, spec)
    for child in node.children:
        collect_attribute_usage(child, source, shape, spec)


def leading_docstring(body: Node | None, source: bytes) -> str | None:
    """A bare string literal as `body`'s first statement, dedented, or None if there isn't one."""
    if body is None or not body.children:
        return None
    first = body.children[0]
    if first.type != "expression_statement" or not first.children:
        return None
    string_node = first.children[0]
    if string_node.type != "string":
        return None
    content_node = next((c for c in string_node.children if c.type == "string_content"), None)
    if content_node is None:
        return None
    return inspect.cleandoc(node_text(content_node, source))


@dataclass(frozen=True, slots=True)
class CommentStyle:
    """Per-grammar doc-comment shape; `//` and `/** */` both parse as one `comment` node type."""

    line_comment_type: str
    line_prefix: str
    block_prefix: str | None = None
    block_suffix: str | None = None
    strip_line_leading_star: bool = False
    # 1 for most grammars (span excludes the trailing newline); Rust's includes it, so it uses 0.
    line_offset: int = 1


def _strip_block_comment(text: str, style: CommentStyle) -> str:
    text = text.removeprefix(style.block_prefix or "").removesuffix(style.block_suffix or "")
    lines = text.splitlines()
    if style.strip_line_leading_star:
        lines = [line.strip().removeprefix("*").strip() for line in lines]
    return inspect.cleandoc("\n".join(lines))


def leading_doc_comment(node: Node | None, source: bytes, style: CommentStyle) -> str | None:
    """Contiguous `//`/`/** */` comment(s) directly above `node` (no blank-line gap), or None."""
    if node is None:
        return None
    comments: list[Node] = []
    current = node
    sibling = node.prev_sibling
    while sibling is not None and sibling.type == style.line_comment_type:
        if sibling.end_point[0] + style.line_offset != current.start_point[0]:
            break
        comments.insert(0, sibling)
        current = sibling
        sibling = sibling.prev_sibling
    if not comments:
        return None
    first_text = node_text(comments[0], source)
    if style.block_prefix is not None and first_text.startswith(style.block_prefix):
        return _strip_block_comment(first_text, style)
    lines = [node_text(c, source).removeprefix(style.line_prefix).strip() for c in comments]
    return inspect.cleandoc("\n".join(lines))


def body_statements(body: Node) -> list[tuple[str, int, int]]:
    """(type, start_line, end_line) per named statement, for GraphBuilder's logic-block split."""
    return [
        (stmt.type, stmt.start_point[0] + 1, stmt.end_point[0] + 1)
        for stmt in body.children
        if stmt.is_named
    ]


def class_symbol(
    node: Node,
    source: bytes,
    file_path: str,
    language: str,
    enclosing_qualname: str | None,
    parent_id: str,
    calls: list[str],
    docstring: str | None = None,
    is_exported: bool = False,
    qualified_calls: list[tuple[str, str]] | None = None,
) -> Symbol:
    """The CLASS Symbol every analyzer emits; `calls` is already collected, by whatever means."""
    name_node = node.child_by_field_name("name")
    name = node_text(name_node, source) if name_node is not None else "<anonymous>"
    qualname = f"{enclosing_qualname}.{name}" if enclosing_qualname else name
    return Symbol(
        id=f"{file_path}::class::{qualname}",
        file_path=file_path,
        kind=SymbolKind.CLASS,
        name=name,
        qualified_name=qualname,
        start_line=node.start_point[0] + 1,
        end_line=node.end_point[0] + 1,
        language=language,
        parent_symbol_id=parent_id,
        references=calls,
        qualified_references=qualified_calls or [],
        docstring=docstring,
        is_exported=is_exported,
    )


def function_symbol(
    span: Node,
    file_path: str,
    language: str,
    name: str,
    qualname: str,
    parent_id: str,
    references: list[str],
    statements: list[tuple[str, int, int]],
    assigned_identifiers: list[str] | None = None,
    docstring: str | None = None,
    is_exported: bool = False,
    qualified_references: list[tuple[str, str]] | None = None,
) -> Symbol:
    """The FUNCTION Symbol every analyzer emits, sharing the id formula and the field mapping."""
    # `span` supplies the line range, not always the node the body came from (TS arrow functions).
    return Symbol(
        id=f"{file_path}::function::{qualname}",
        file_path=file_path,
        kind=SymbolKind.FUNCTION,
        name=name,
        qualified_name=qualname,
        start_line=span.start_point[0] + 1,
        end_line=span.end_point[0] + 1,
        language=language,
        parent_symbol_id=parent_id,
        references=references,
        qualified_references=qualified_references or [],
        assigned_identifiers=assigned_identifiers or [],
        body_statements=statements,
        docstring=docstring,
        is_exported=is_exported,
    )


def _not_exported(node: Node, source: bytes) -> bool:
    """Default `TraversalSpec.is_exported` for a grammar with no such concept (e.g. Ruby)."""
    return False


@dataclass(frozen=True, slots=True)
class TraversalSpec:
    """Per-grammar node-type tables and hooks the class/function/else tree-walk below needs."""

    class_types: tuple[str, ...]
    function_types: tuple[str, ...]
    collect_calls: Callable[[Node, bytes, list[str]], None]
    doc_for: Callable[[Node, bytes], str | None]
    is_exported: Callable[[Node, bytes], bool] = _not_exported


def walk_classes_and_functions(
    root: Node, source: bytes, file_path: str, language: str, module_id: str, spec: TraversalSpec
) -> list[Symbol]:
    """Class -> symbol, recurse into its body; function -> symbol, no recursion; else -> recurse."""
    symbols: list[Symbol] = []

    def visit(node: Node, enclosing_qualname: str | None, parent_id: str) -> None:
        for child in node.children:
            if child.type in spec.class_types:
                if child.child_by_field_name("name") is None:
                    continue
                calls: list[str] = []
                spec.collect_calls(child, source, calls)
                symbol = class_symbol(
                    child, source, file_path, language, enclosing_qualname, parent_id, calls,
                    docstring=spec.doc_for(child, source),
                    is_exported=spec.is_exported(child, source),
                )
                symbols.append(symbol)
                body = child.child_by_field_name("body")
                if body is not None:
                    visit(body, symbol.qualified_name, symbol.id)
            elif child.type in spec.function_types:
                name_node = child.child_by_field_name("name")
                if name_node is None:
                    continue
                name = node_text(name_node, source)
                qualname = f"{enclosing_qualname}.{name}" if enclosing_qualname else name
                calls = []
                body = child.child_by_field_name("body")
                statements: list[tuple[str, int, int]] = []
                if body is not None:
                    spec.collect_calls(body, source, calls)
                    statements = body_statements(body)
                symbols.append(
                    function_symbol(
                        child, file_path, language, name, qualname, parent_id, calls, statements,
                        docstring=spec.doc_for(child, source),
                        is_exported=spec.is_exported(child, source),
                    )
                )
            else:
                visit(child, enclosing_qualname, parent_id)

    visit(root, None, module_id)
    return symbols


def parse_module(
    grammar: Language, source: bytes, file_path: str, language: str, spec: TraversalSpec
) -> list[Symbol]:
    """The whole-file `parse()` body shared by every analyzer with no per-language parse quirks."""
    root = Parser(grammar).parse(source).root_node
    dotted = module_dotted_path(file_path)
    module = module_symbol(root, file_path, language, dotted, {})
    symbols = [module]
    symbols += walk_classes_and_functions(root, source, file_path, language, module.id, spec)
    return symbols


def module_symbol(
    root: Node,
    file_path: str,
    language: str,
    dotted: str,
    imports: dict[str, str],
    docstring: str | None = None,
) -> Symbol:
    """The one MODULE symbol every analyzer emits per file, spanning the whole parse tree."""
    return Symbol(
        id=f"{file_path}::module::{dotted}",
        file_path=file_path,
        kind=SymbolKind.MODULE,
        name=dotted.rsplit(".", 1)[-1] if dotted else file_path,
        qualified_name=dotted,
        start_line=root.start_point[0] + 1,
        end_line=root.end_point[0] + 1,
        language=language,
        imports=imports,
        docstring=docstring,
    )
