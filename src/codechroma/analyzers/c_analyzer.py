"""C LanguageAnalyzer backed by py-tree-sitter + tree-sitter-c."""

from __future__ import annotations

import tree_sitter_c as tsc
from tree_sitter import Language, Node, Parser

from codechroma.analyzers.tree_sitter_common import (
    CallSpec,
    CommentStyle,
    body_statements,
    collect_calls,
    function_symbol,
    leading_doc_comment,
    module_dotted_path,
    module_symbol,
    no_import_resolution,
    node_text,
)
from codechroma.graph.models import ClassShape, Symbol

_LANGUAGE = Language(tsc.language())
_CALLS = CallSpec(call_type="call_expression", member_type="field_expression", member_field="field")
_DOC_STYLE = CommentStyle(
    line_comment_type="comment", line_prefix="//", block_prefix="/**",
    block_suffix="*/", strip_line_leading_star=True,
)
_NAME_TYPES = ("identifier", "field_identifier")


def function_declarator_name(declarator: Node | None, source: bytes) -> str | None:
    """Descends through `pointer_declarator`/`function_declarator` wrappers to the bare name."""
    if declarator is None:
        return None
    if declarator.type in _NAME_TYPES:
        return node_text(declarator, source)
    inner = declarator.child_by_field_name("declarator")
    return function_declarator_name(inner, source)


class CAnalyzer:
    """LanguageAnalyzer implementation for C source files. Claims only `.c` -- never `.h`."""

    language = "c"
    extensions = (".c",)

    def class_shapes(self, file_path: str, source: bytes) -> dict[str, ClassShape] | None:
        """No class-like construct in C -- always None."""
        return None

    resolve_import = staticmethod(no_import_resolution)

    def parse(self, file_path: str, source: bytes) -> list[Symbol]:
        root = Parser(_LANGUAGE).parse(source).root_node
        dotted = module_dotted_path(file_path)
        module = module_symbol(root, file_path, self.language, dotted, {})
        symbols = [module]

        for node in root.children:
            if node.type != "function_definition":
                continue
            declarator = node.child_by_field_name("declarator")
            name = function_declarator_name(declarator, source)
            if name is None:
                continue
            calls: list[str] = []
            body = node.child_by_field_name("body")
            statements: list[tuple[str, int, int]] = []
            if body is not None:
                collect_calls(body, source, calls, _CALLS)
                statements = body_statements(body)
            symbols.append(
                function_symbol(
                    node, file_path, self.language, name, name, module.id, calls, statements,
                    docstring=leading_doc_comment(node, source, _DOC_STYLE),
                )
            )

        return symbols
