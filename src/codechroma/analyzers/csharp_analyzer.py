"""C# LanguageAnalyzer backed by py-tree-sitter + tree-sitter-c-sharp."""

from __future__ import annotations

import re

import tree_sitter_c_sharp as tscsharp
from tree_sitter import Language, Node

from codechroma.analyzers.tree_sitter_common import (
    CallSpec,
    CommentStyle,
    TraversalSpec,
    collect_calls,
    leading_doc_comment,
    no_import_resolution,
    node_text,
    parse_module,
)
from codechroma.graph.models import ClassShape, Symbol

_LANGUAGE = Language(tscsharp.language())
_CALLS = CallSpec(
    call_type="invocation_expression", member_type="member_access_expression", member_field="name"
)
_DOC_STYLE = CommentStyle(line_comment_type="comment", line_prefix="///")
_CLASS_TYPES = ("class_declaration", "interface_declaration", "struct_declaration")
_FUNCTION_TYPES = ("method_declaration", "constructor_declaration")
_XML_TAG_RE = re.compile(r"</?summary>")


def _strip_xml_doc_tags(text: str) -> str:
    """Drops the `<summary>`/`</summary>` wrapper XML doc-comments use around their real text."""
    return "\n".join(
        line for line in (_XML_TAG_RE.sub("", ln).strip() for ln in text.splitlines()) if line
    )


def _doc_for(node: Node, source: bytes) -> str | None:
    doc = leading_doc_comment(node, source, _DOC_STYLE)
    return _strip_xml_doc_tags(doc) if doc is not None else None


def _has_public_modifier(node: Node, source: bytes) -> bool:
    return any(
        c.type == "modifier" and node_text(c, source) == "public" for c in node.children
    )


def _collect_calls(node: Node, source: bytes, out: list[str]) -> None:
    collect_calls(node, source, out, _CALLS)


_TRAVERSAL = TraversalSpec(
    class_types=_CLASS_TYPES,
    function_types=_FUNCTION_TYPES,
    collect_calls=_collect_calls,
    doc_for=_doc_for,
    is_exported=_has_public_modifier,
)


class CSharpAnalyzer:
    """LanguageAnalyzer implementation for C# source files."""

    language = "csharp"
    extensions = (".cs",)

    def class_shapes(self, file_path: str, source: bytes) -> dict[str, ClassShape] | None:
        """Deferred in this pass -- see spec Assumptions."""
        return None

    resolve_import = staticmethod(no_import_resolution)

    def parse(self, file_path: str, source: bytes) -> list[Symbol]:
        return parse_module(_LANGUAGE, source, file_path, self.language, _TRAVERSAL)
