"""Java LanguageAnalyzer backed by py-tree-sitter + tree-sitter-java."""

from __future__ import annotations

import tree_sitter_java as tsjava
from tree_sitter import Language, Node

from codechroma.analyzers.tree_sitter_common import (
    CommentStyle,
    TraversalSpec,
    leading_doc_comment,
    no_import_resolution,
    node_text,
    parse_module,
)
from codechroma.graph.models import ClassShape, Symbol

_LANGUAGE = Language(tsjava.language())
_DOC_STYLE = CommentStyle(
    line_comment_type="block_comment", line_prefix="", block_prefix="/**",
    block_suffix="*/", strip_line_leading_star=True,
)
_CLASS_TYPES = ("class_declaration", "interface_declaration", "enum_declaration")
_FUNCTION_TYPES = ("method_declaration", "constructor_declaration")


def _collect_java_calls(node: Node, source: bytes, out: list[str]) -> None:
    """Java's `method_invocation` names its callee via a `name` field, not a `function` field."""
    if node.type == "method_invocation":
        name_node = node.child_by_field_name("name")
        if name_node is not None:
            out.append(node_text(name_node, source))
    for child in node.children:
        _collect_java_calls(child, source, out)


def _is_public(node: Node, _source: bytes) -> bool:
    modifiers = next((c for c in node.children if c.type == "modifiers"), None)
    return modifiers is not None and any(c.type == "public" for c in modifiers.children)


def _doc_for(node: Node, source: bytes) -> str | None:
    return leading_doc_comment(node, source, _DOC_STYLE)


_TRAVERSAL = TraversalSpec(
    class_types=_CLASS_TYPES,
    function_types=_FUNCTION_TYPES,
    collect_calls=_collect_java_calls,
    doc_for=_doc_for,
    is_exported=_is_public,
)


class JavaAnalyzer:
    """LanguageAnalyzer implementation for Java source files."""

    language = "java"
    extensions = (".java",)

    def class_shapes(self, file_path: str, source: bytes) -> dict[str, ClassShape] | None:
        """Deferred in this pass -- see spec Assumptions."""
        return None

    resolve_import = staticmethod(no_import_resolution)

    def parse(self, file_path: str, source: bytes) -> list[Symbol]:
        return parse_module(_LANGUAGE, source, file_path, self.language, _TRAVERSAL)
