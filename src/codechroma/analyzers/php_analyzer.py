"""PHP LanguageAnalyzer backed by py-tree-sitter + tree-sitter-php."""

from __future__ import annotations

import tree_sitter_php as tsphp
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

_LANGUAGE = Language(tsphp.language_php())
_DOC_STYLE = CommentStyle(
    line_comment_type="comment", line_prefix="", block_prefix="/**",
    block_suffix="*/", strip_line_leading_star=True,
)
_CLASS_TYPES = ("class_declaration", "interface_declaration", "trait_declaration")
_FUNCTION_TYPES = ("method_declaration", "function_definition")


def _collect_php_calls(node: Node, source: bytes, out: list[str]) -> None:
    """PHP splits a call into `function_call_expression` and `member_call_expression`."""
    if node.type == "function_call_expression":
        fn = node.child_by_field_name("function")
        if fn is not None and fn.type == "name":
            out.append(node_text(fn, source))
    elif node.type == "member_call_expression":
        name = node.child_by_field_name("name")
        if name is not None:
            out.append(node_text(name, source))
    for child in node.children:
        _collect_php_calls(child, source, out)


def _is_not_private(node: Node, source: bytes) -> bool:
    return not any(
        c.type == "visibility_modifier" and node_text(c, source) == "private"
        for c in node.children
    )


def _doc_for(node: Node, source: bytes) -> str | None:
    return leading_doc_comment(node, source, _DOC_STYLE)


_TRAVERSAL = TraversalSpec(
    class_types=_CLASS_TYPES,
    function_types=_FUNCTION_TYPES,
    collect_calls=_collect_php_calls,
    doc_for=_doc_for,
    is_exported=_is_not_private,
)


class PhpAnalyzer:
    """LanguageAnalyzer implementation for PHP source files."""

    language = "php"
    extensions = (".php",)

    def class_shapes(self, file_path: str, source: bytes) -> dict[str, ClassShape] | None:
        """Deferred in this pass -- see spec Assumptions."""
        return None

    resolve_import = staticmethod(no_import_resolution)

    def parse(self, file_path: str, source: bytes) -> list[Symbol]:
        return parse_module(_LANGUAGE, source, file_path, self.language, _TRAVERSAL)
