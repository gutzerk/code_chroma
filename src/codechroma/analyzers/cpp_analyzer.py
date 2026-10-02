"""C++ LanguageAnalyzer backed by py-tree-sitter + tree-sitter-cpp."""

from __future__ import annotations

import tree_sitter_cpp as tscpp
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

_LANGUAGE = Language(tscpp.language())
_CALLS = CallSpec(call_type="call_expression", member_type="field_expression", member_field="field")
_DOC_STYLE = CommentStyle(
    line_comment_type="comment", line_prefix="//", block_prefix="/**",
    block_suffix="*/", strip_line_leading_star=True,
)
_CLASS_TYPES = ("class_specifier", "struct_specifier")


def _scope_class_name(scope: Node, source: bytes) -> str:
    """Rightmost class name in a (possibly namespace-qualified) `Class::method` scope."""
    if scope.type == "qualified_identifier":
        name = scope.child_by_field_name("name")
        return node_text(name, source) if name is not None else node_text(scope, source)
    return node_text(scope, source)


def _resolve_declarator(declarator: Node | None, source: bytes) -> tuple[str | None, str] | None:
    """Like `function_declarator_name`, but also resolves an out-of-line `Class::method` name."""
    if declarator is None:
        return None
    if declarator.type in ("identifier", "field_identifier"):
        return None, node_text(declarator, source)
    if declarator.type == "qualified_identifier":
        scope = declarator.child_by_field_name("scope")
        name = declarator.child_by_field_name("name")
        if scope is None or name is None:
            return None
        return _scope_class_name(scope, source), node_text(name, source)
    inner = declarator.child_by_field_name("declarator")
    return _resolve_declarator(inner, source)


class CppAnalyzer:
    """LanguageAnalyzer for C++; also claims `.h` -- the one intentional shared-extension case."""

    language = "cpp"
    extensions = (".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".h")

    def class_shapes(self, file_path: str, source: bytes) -> dict[str, ClassShape] | None:
        """Deferred in this pass -- see spec Assumptions."""
        return None

    resolve_import = staticmethod(no_import_resolution)

    def parse(self, file_path: str, source: bytes) -> list[Symbol]:
        root = Parser(_LANGUAGE).parse(source).root_node
        dotted = module_dotted_path(file_path)
        module = module_symbol(root, file_path, self.language, dotted, {})
        symbols = [module]
        type_ids: dict[str, str] = {}

        def visit(node: Node, enclosing_qualname: str | None, parent_id: str) -> None:
            for child in node.children:
                if child.type in _CLASS_TYPES:
                    if child.child_by_field_name("name") is None:
                        continue
                    calls: list[str] = []
                    collect_calls(child, source, calls, _CALLS)
                    symbol = class_symbol(
                        child, source, file_path, self.language, enclosing_qualname, parent_id,
                        calls,
                        docstring=leading_doc_comment(child, source, _DOC_STYLE),
                    )
                    symbols.append(symbol)
                    type_ids[symbol.name] = symbol.id
                    body = child.child_by_field_name("body")
                    if body is not None:
                        visit(body, symbol.qualified_name, symbol.id)
                elif child.type == "function_definition":
                    declarator = child.child_by_field_name("declarator")
                    resolved = _resolve_declarator(declarator, source)
                    if resolved is None:
                        continue
                    scope_name, fn_name = resolved
                    if scope_name is not None:
                        # Out-of-line `Class::method` -- parent it to the class, not the file spot.
                        fn_parent_id = type_ids.get(scope_name, parent_id)
                        qualname = f"{scope_name}.{fn_name}"
                    else:
                        fn_parent_id = parent_id
                        qualname = (
                            f"{enclosing_qualname}.{fn_name}" if enclosing_qualname else fn_name
                        )
                    calls = []
                    body = child.child_by_field_name("body")
                    statements: list[tuple[str, int, int]] = []
                    if body is not None:
                        collect_calls(body, source, calls, _CALLS)
                        statements = body_statements(body)
                    symbols.append(
                        function_symbol(
                            child, file_path, self.language, fn_name, qualname, fn_parent_id,
                            calls, statements,
                            docstring=leading_doc_comment(child, source, _DOC_STYLE),
                        )
                    )
                else:
                    visit(child, enclosing_qualname, parent_id)

        visit(root, None, module.id)
        return symbols
