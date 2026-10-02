"""TypeScript/JavaScript LanguageAnalyzer backed by py-tree-sitter + tree-sitter-typescript."""

from __future__ import annotations

import posixpath
from pathlib import Path

import tree_sitter_typescript as tsts
from tree_sitter import Language, Node, Parser

from codechroma.analyzers.tree_sitter_common import (
    CallSpec,
    CommentStyle,
    body_statements,
    class_symbol,
    collect_calls,
    confined_relpath,
    function_symbol,
    leading_doc_comment,
    module_dotted_path,
    module_symbol,
    node_text,
)
from codechroma.graph.models import ClassShape, Symbol

_LANGUAGE = Language(tsts.language_typescript())
_CALLS = CallSpec(
    call_type="call_expression",
    member_type="member_expression",
    member_field="property",
    object_field="object",
)
_DOC_STYLE = CommentStyle(
    line_comment_type="comment",
    line_prefix="//",
    block_prefix="/**",
    block_suffix="*/",
    strip_line_leading_star=True,
)
_EXPORT_WRAPPER_TYPES = ("lexical_declaration", "export_statement")
_TS_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx")


def _resolve_ts_import(import_text: str, importer_file: str, repo_root: Path) -> str | None:
    """Relative specifiers only -- probes `.ts/.tsx/.js/.jsx`/`index.*`; bare specifiers None."""
    if not (import_text.startswith("./") or import_text.startswith("../")):
        return None
    repo_root = repo_root.resolve()
    importer_dir = Path(importer_file).parent.as_posix()
    combined = confined_relpath(posixpath.join(importer_dir, import_text))
    if combined is None:
        return None
    if (repo_root / combined).is_file():
        return combined
    for ext in _TS_EXTENSIONS:
        candidate = f"{combined}{ext}"
        if (repo_root / candidate).is_file():
            return candidate
    for ext in _TS_EXTENSIONS:
        candidate = f"{combined}/index{ext}"
        if (repo_root / candidate).is_file():
            return candidate
    return None


def _doc_anchor(node: Node) -> tuple[Node, bool]:
    """Walks up through `export`/`const` wrappers (research.md §3) to the real comment anchor."""
    anchor = node
    is_exported = False
    parent = node.parent
    while parent is not None and parent.type in _EXPORT_WRAPPER_TYPES:
        anchor = parent
        is_exported = is_exported or parent.type == "export_statement"
        parent = parent.parent
    return anchor, is_exported


def _module_doc_anchor(root: Node) -> Node | None:
    """First non-comment top-level node in `program` -- where a file-top JSDoc block attaches."""
    return next((c for c in root.children if c.type != "comment"), None)


def _doc_fields(node: Node, source: bytes) -> tuple[str | None, bool]:
    """(docstring, is_exported) for a class/function node, resolving the export-wrapper anchor."""
    anchor, is_exported = _doc_anchor(node)
    return leading_doc_comment(anchor, source, _DOC_STYLE), is_exported


def _parse_imports(root: Node, source: bytes) -> dict[str, str]:
    imports: dict[str, str] = {}
    for node in root.children:
        if node.type != "import_statement":
            continue
        source_node = node.child_by_field_name("source")
        module = node_text(source_node, source).strip("'\"") if source_node is not None else ""
        for child in node.children:
            if child.type == "import_clause":
                for name_node in child.children:
                    if name_node.type == "identifier":
                        imports[node_text(name_node, source)] = module
                    elif name_node.type == "named_imports":
                        for spec in name_node.children:
                            if spec.type == "import_specifier":
                                local = spec.child_by_field_name(
                                    "alias"
                                ) or spec.child_by_field_name("name")
                                if local is not None:
                                    imports[node_text(local, source)] = module
    return imports


def _extract_function(
    node: Node, source: bytes, file_path: str, enclosing_qualname: str | None, parent_id: str
) -> Symbol | None:
    name_node = node.child_by_field_name("name")
    if name_node is None:
        return None
    name = node_text(name_node, source)
    qualname = f"{enclosing_qualname}.{name}" if enclosing_qualname else name
    calls: list[str] = []
    qualified: list[tuple[str, str]] = []
    body = node.child_by_field_name("body")
    statements: list[tuple[str, int, int]] = []
    if body is not None:
        collect_calls(body, source, calls, _CALLS, qualified)
        statements = body_statements(body)
    docstring, is_exported = _doc_fields(node, source)
    return function_symbol(
        node,
        file_path,
        "typescript",
        name,
        qualname,
        parent_id,
        calls,
        statements,
        docstring=docstring,
        is_exported=is_exported,
        qualified_references=qualified,
    )


def _extract_arrow_function(
    declarator: Node,
    arrow_node: Node,
    source: bytes,
    file_path: str,
    enclosing_qualname: str | None,
    parent_id: str,
) -> Symbol | None:
    """Symbol for `name = (...) => {...}`, name taken from the declarator, body from the arrow."""
    name_node = declarator.child_by_field_name("name")
    if name_node is None:
        return None
    name = node_text(name_node, source)
    qualname = f"{enclosing_qualname}.{name}" if enclosing_qualname else name
    calls: list[str] = []
    qualified: list[tuple[str, str]] = []
    body = arrow_node.child_by_field_name("body")
    statements: list[tuple[str, int, int]] = []
    if body is not None:
        collect_calls(body, source, calls, _CALLS, qualified)
        if body.type == "statement_block":
            statements = body_statements(body)
    docstring, is_exported = _doc_fields(declarator, source)
    # The declarator spans the line range, not the arrow: `const f = () => …` starts at `const`.
    return function_symbol(
        declarator,
        file_path,
        "typescript",
        name,
        qualname,
        parent_id,
        calls,
        statements,
        docstring=docstring,
        is_exported=is_exported,
        qualified_references=qualified,
    )


class TypeScriptAnalyzer:
    """LanguageAnalyzer implementation for TypeScript/JavaScript source files."""

    language = "typescript"
    extensions = (".ts", ".tsx", ".js", ".jsx")

    def class_shapes(self, file_path: str, source: bytes) -> dict[str, ClassShape] | None:
        """No shape extraction for TS yet -- None keeps this language out of pattern detection."""
        return None

    def resolve_import(self, import_text: str, importer_file: str, repo_root: Path) -> str | None:
        """Repo-relative file a relative (`./`/`../`) import resolves to; bare specifiers None."""
        return _resolve_ts_import(import_text, importer_file, repo_root)

    def parse(self, file_path: str, source: bytes) -> list[Symbol]:
        root = Parser(_LANGUAGE).parse(source).root_node
        dotted = module_dotted_path(file_path)
        module_doc = leading_doc_comment(_module_doc_anchor(root), source, _DOC_STYLE)
        module = module_symbol(
            root, file_path, self.language, dotted, _parse_imports(root, source), module_doc
        )
        symbols = [module]

        def visit(node: Node, enclosing_qualname: str | None, parent_id: str) -> None:
            for child in node.children:
                if child.type in ("function_declaration", "method_definition"):
                    symbol = _extract_function(
                        child, source, file_path, enclosing_qualname, parent_id
                    )
                    if symbol is not None:
                        symbols.append(symbol)
                        visit(child, symbol.qualified_name, symbol.id)
                    else:
                        visit(child, enclosing_qualname, parent_id)
                elif child.type == "class_declaration":
                    docstring, is_exported = _doc_fields(child, source)
                    calls: list[str] = []
                    qualified: list[tuple[str, str]] = []
                    collect_calls(child, source, calls, _CALLS, qualified)
                    symbol = class_symbol(
                        child,
                        source,
                        file_path,
                        self.language,
                        enclosing_qualname,
                        parent_id,
                        calls,
                        docstring=docstring,
                        is_exported=is_exported,
                        qualified_calls=qualified,
                    )
                    symbols.append(symbol)
                    visit(child, symbol.qualified_name, symbol.id)
                elif child.type == "variable_declarator":
                    value = child.child_by_field_name("value")
                    symbol = (
                        _extract_arrow_function(
                            child, value, source, file_path, enclosing_qualname, parent_id
                        )
                        if value is not None and value.type == "arrow_function"
                        else None
                    )
                    if symbol is not None:
                        assert value is not None  # symbol is only non-None when value was, above
                        symbols.append(symbol)
                        visit(value, symbol.qualified_name, symbol.id)
                    else:
                        visit(child, enclosing_qualname, parent_id)
                else:
                    visit(child, enclosing_qualname, parent_id)

        visit(root, None, module.id)
        return symbols
