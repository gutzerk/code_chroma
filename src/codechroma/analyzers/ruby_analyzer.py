"""Ruby LanguageAnalyzer backed by py-tree-sitter + tree-sitter-ruby."""

from __future__ import annotations

import tree_sitter_ruby as tsruby
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

_LANGUAGE = Language(tsruby.language())
_DOC_STYLE = CommentStyle(line_comment_type="comment", line_prefix="#")
_CLASS_TYPES = ("class", "module")
_FUNCTION_TYPES = ("method",)


def _doc_anchor(node: Node) -> Node:
    """A leading comment for the first statement in a `body_statement` is that wrapper's sibling."""
    anchor = node
    while (
        anchor.prev_sibling is None
        and anchor.parent is not None
        and anchor.parent.type == "body_statement"
    ):
        anchor = anchor.parent
    return anchor


def _collect_ruby_calls(node: Node, source: bytes, out: list[str]) -> None:
    """Ruby's `call` node names its callee via a `method` field, not a `function` field."""
    if node.type == "call":
        method = node.child_by_field_name("method")
        if method is not None:
            out.append(node_text(method, source))
    for child in node.children:
        _collect_ruby_calls(child, source, out)


def _doc_for(node: Node, source: bytes) -> str | None:
    return leading_doc_comment(_doc_anchor(node), source, _DOC_STYLE)


_TRAVERSAL = TraversalSpec(
    class_types=_CLASS_TYPES,
    function_types=_FUNCTION_TYPES,
    collect_calls=_collect_ruby_calls,
    doc_for=_doc_for,
)


class RubyAnalyzer:
    """LanguageAnalyzer implementation for Ruby source files."""

    language = "ruby"
    extensions = (".rb",)

    def class_shapes(self, file_path: str, source: bytes) -> dict[str, ClassShape] | None:
        """No AttributeSpec reuse -- Ruby's `@ivar` idiom doesn't fit self/cls, so this is None."""
        return None

    resolve_import = staticmethod(no_import_resolution)

    def parse(self, file_path: str, source: bytes) -> list[Symbol]:
        return parse_module(_LANGUAGE, source, file_path, self.language, _TRAVERSAL)
