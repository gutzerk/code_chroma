"""Rust LanguageAnalyzer backed by py-tree-sitter + tree-sitter-rust."""

from __future__ import annotations

import inspect

import tree_sitter_rust as tsrust
from tree_sitter import Language, Node, Parser

from codechroma.analyzers.tree_sitter_common import (
    CallSpec,
    CommentStyle,
    body_statements,
    class_symbol,
    collect_calls,
    function_symbol,
    leading_doc_comment,
    module_dotted_path,
    module_symbol,
    no_import_resolution,
    node_text,
)
from codechroma.graph.models import ClassShape, Symbol

_LANGUAGE = Language(tsrust.language())
_CALLS = CallSpec(call_type="call_expression", member_type="field_expression", member_field="field")
_CLASS_TYPES = ("struct_item", "enum_item", "trait_item")
_FUNCTION_TYPES = ("function_item", "function_signature_item")
# line_offset=0: Rust's line_comment span includes its own trailing newline (see CommentStyle).
_DOC_STYLE = CommentStyle(line_comment_type="line_comment", line_prefix="///", line_offset=0)


def _module_doc(root: Node, source: bytes) -> str | None:
    """Leading contiguous `//!` comments at the top of the file -- Rust's module-doc convention."""
    lines: list[str] = []
    for child in root.children:
        if child.type != "line_comment":
            break
        inner = next((c for c in child.children if c.type == "inner_doc_comment_marker"), None)
        if inner is None:
            break
        text = node_text(child, source).removeprefix("//!").strip()
        lines.append(text)
    return inspect.cleandoc("\n".join(lines)) if lines else None


def _impl_type_name(impl_node: Node, source: bytes) -> str | None:
    type_node = impl_node.child_by_field_name("type")
    if type_node is None:
        return None
    if type_node.type == "type_identifier":
        name_node: Node | None = type_node
    elif type_node.type == "generic_type":
        name_node = type_node.child_by_field_name("type")
    else:
        return None
    return node_text(name_node, source) if name_node is not None else None


def _function_symbol(
    node: Node, file_path: str, language: str, qualname: str, parent_id: str, source: bytes
) -> Symbol:
    name_node = node.child_by_field_name("name")
    name = node_text(name_node, source) if name_node is not None else qualname
    calls: list[str] = []
    body = node.child_by_field_name("body")
    statements: list[tuple[str, int, int]] = []
    if body is not None:
        collect_calls(body, source, calls, _CALLS)
        statements = body_statements(body)
    return function_symbol(
        node, file_path, language, name, qualname, parent_id, calls, statements,
        docstring=leading_doc_comment(node, source, _DOC_STYLE),
    )


def _flatten_items(items: list[Node]) -> list[Node]:
    """Inlines `mod_item` bodies so nested `mod` blocks aren't invisible to the two item passes."""
    flat: list[Node] = []
    for item in items:
        if item.type == "mod_item":
            body = item.child_by_field_name("body")
            if body is not None:
                flat.extend(_flatten_items(list(body.children)))
        else:
            flat.append(item)
    return flat


def _emit_members(
    body: Node | None,
    file_path: str,
    language: str,
    prefix: str | None,
    parent_id: str,
    source: bytes,
    symbols: list[Symbol],
) -> None:
    """Shared by trait and impl bodies: one FUNCTION symbol per `_FUNCTION_TYPES` member."""
    if body is None:
        return
    for member in body.children:
        if member.type not in _FUNCTION_TYPES:
            continue
        name_node = member.child_by_field_name("name")
        if name_node is None:
            continue
        mname = node_text(name_node, source)
        qualname = f"{prefix}.{mname}" if prefix else mname
        symbols.append(_function_symbol(member, file_path, language, qualname, parent_id, source))


class RustAnalyzer:
    """LanguageAnalyzer implementation for Rust source files."""

    language = "rust"
    extensions = (".rs",)

    def class_shapes(self, file_path: str, source: bytes) -> dict[str, ClassShape] | None:
        """Deferred in this pass -- see spec Assumptions."""
        return None

    resolve_import = staticmethod(no_import_resolution)

    def parse(self, file_path: str, source: bytes) -> list[Symbol]:
        root = Parser(_LANGUAGE).parse(source).root_node
        dotted = module_dotted_path(file_path)
        module = module_symbol(
            root, file_path, self.language, dotted, {}, _module_doc(root, source)
        )
        symbols: list[Symbol] = [module]
        type_ids: dict[str, str] = {}
        items = _flatten_items(list(root.children))

        for node in items:
            if node.type not in _CLASS_TYPES:
                continue
            calls: list[str] = []
            collect_calls(node, source, calls, _CALLS)
            symbol = class_symbol(
                node, source, file_path, self.language, None, module.id, calls,
                docstring=leading_doc_comment(node, source, _DOC_STYLE),
            )
            symbols.append(symbol)
            type_ids[symbol.name] = symbol.id
            if node.type == "trait_item":
                body = node.child_by_field_name("body")
                _emit_members(
                    body, file_path, self.language, symbol.name, symbol.id, source, symbols
                )

        for node in items:
            if node.type == "function_item":
                name_node = node.child_by_field_name("name")
                if name_node is None:
                    continue
                name = node_text(name_node, source)
                symbols.append(
                    _function_symbol(node, file_path, self.language, name, module.id, source)
                )
            elif node.type == "impl_item":
                type_name = _impl_type_name(node, source)
                parent_id = type_ids.get(type_name or "", module.id)
                body = node.child_by_field_name("body")
                _emit_members(body, file_path, self.language, type_name, parent_id, source, symbols)

        return symbols
