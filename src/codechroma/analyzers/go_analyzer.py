"""Go LanguageAnalyzer backed by py-tree-sitter + tree-sitter-go."""

from __future__ import annotations

from pathlib import Path

import tree_sitter_go as tsgo
from tree_sitter import Language, Node, Parser

from codechroma.analyzers.tree_sitter_common import (
    CallSpec,
    CommentStyle,
    body_statements,
    collect_calls,
    confined_relpath,
    find_ancestor_file,
    function_symbol,
    leading_doc_comment,
    module_dotted_path,
    module_symbol,
    node_text,
)
from codechroma.graph.models import ClassShape, MethodShape, Symbol, SymbolKind

_LANGUAGE = Language(tsgo.language())
_CALLS = CallSpec(
    call_type="call_expression",
    member_type="selector_expression",
    member_field="field",
    object_field="operand",
)
_DOC_STYLE = CommentStyle(line_comment_type="comment", line_prefix="//")


def _read_go_module_name(gomod_path: Path) -> str | None:
    """The `module <name>` directive's `<name>`, or None if `go.mod` has no such line."""
    for line in gomod_path.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if stripped.startswith("module "):
            return stripped[len("module ") :].strip()
    return None


def _resolve_go_import(import_text: str, importer_file: str, repo_root: Path) -> str | None:
    repo_root = repo_root.resolve()
    importer_dir = repo_root / Path(importer_file).parent
    gomod = find_ancestor_file(importer_dir, repo_root, "go.mod")
    if gomod is None:
        return None
    module_name = _read_go_module_name(gomod)
    if not module_name:
        return None
    if import_text == module_name:
        rel_dir = Path()
    elif import_text.startswith(module_name + "/"):
        rel_dir = Path(import_text[len(module_name) + 1 :])
    else:
        return None
    candidate_dir = confined_relpath((gomod.parent.relative_to(repo_root) / rel_dir).as_posix())
    if candidate_dir is None:
        return None
    return candidate_dir if (repo_root / candidate_dir).is_dir() else None


def _module_doc_anchor(root: Node) -> Node | None:
    """`package_clause` itself -- Go's `// Package foo ...` doc comment precedes that node."""
    return next((c for c in root.children if c.type == "package_clause"), None)


def _is_exported(name: str) -> bool:
    """Go's own export rule: a capitalized identifier, not an `export` keyword (empty -> False)."""
    return name[:1].isupper()


def _go_body_statements(block: Node) -> list[tuple[str, int, int]]:
    """Go wraps a function body's statements in a `statement_list` the other grammars don't have."""
    return body_statements(next((c for c in block.children if c.type == "statement_list"), block))


def _receiver_type_name(method: Node, source: bytes) -> str | None:
    """Underlying type name of a method receiver, e.g. `(w *Widget)` -> `Widget`."""
    receiver = method.child_by_field_name("receiver")
    if receiver is None:
        return None
    ident = _find_first(receiver, "type_identifier")
    return node_text(ident, source) if ident is not None else None


def _find_first(node: Node, node_type: str) -> Node | None:
    if node.type == node_type:
        return node
    for child in node.children:
        found = _find_first(child, node_type)
        if found is not None:
            return found
    return None


def _receiver_var_name(method: Node, source: bytes) -> str | None:
    """Receiver's variable name, e.g. `(w *Widget)` -> `w` -- the Go analog of `self`."""
    receiver = method.child_by_field_name("receiver")
    if receiver is None:
        return None
    param = next((c for c in receiver.children if c.type == "parameter_declaration"), None)
    if param is None:
        return None
    name_node = param.child_by_field_name("name")
    return node_text(name_node, source) if name_node is not None else None


def _import_path(spec: Node, source: bytes) -> str:
    path_node = spec.child_by_field_name("path")
    return node_text(path_node, source).strip("'\"`") if path_node is not None else ""


def _parse_imports(root: Node, source: bytes) -> dict[str, str]:
    imports: dict[str, str] = {}
    for node in root.children:
        if node.type != "import_declaration":
            continue
        specs: list[Node] = []
        _collect_by_type(node, "import_spec", specs)
        for spec in specs:
            path = _import_path(spec, source)
            if not path:
                continue
            alias_node = spec.child_by_field_name("name")
            local = (
                node_text(alias_node, source)
                if alias_node is not None
                else path.rsplit("/", 1)[-1]
            )
            imports[local] = path
    return imports


def _collect_by_type(node: Node, node_type: str, out: list[Node]) -> None:
    if node.type == node_type:
        out.append(node)
        return
    for child in node.children:
        _collect_by_type(child, node_type, out)


def _collect_assigned_identifiers(node: Node, source: bytes, out: list[str]) -> None:
    """Plain identifier assignment targets in `node`'s subtree, for scoping singleton detection."""
    if node.type in ("assignment_statement", "short_var_declaration"):
        left = node.child_by_field_name("left")
        for target in _expression_list_items(left):
            if target.type == "identifier":
                out.append(node_text(target, source))
    for child in node.children:
        _collect_assigned_identifiers(child, source, out)


def _package_pointer_vars(
    root: Node, file_path: str, language: str, module_id: str, source: bytes
) -> list[Symbol]:
    """Package-level `var x *T` symbols -- the shape `_detect_singleton_go` looks for."""
    symbols: list[Symbol] = []
    for node in root.children:
        if node.type != "var_declaration":
            continue
        specs: list[Node] = []
        _collect_by_type(node, "var_spec", specs)
        for spec in specs:
            name_node = spec.child_by_field_name("name")
            type_node = spec.child_by_field_name("type")
            if name_node is None or type_node is None or type_node.type != "pointer_type":
                continue
            name = node_text(name_node, source)
            # Pointee type name (e.g. "Widget") so _detect_singleton_go can resolve the real struct.
            pointee = _type_name(type_node, source)
            symbols.append(
                Symbol(
                    id=f"{file_path}::variable::{name}",
                    file_path=file_path,
                    kind=SymbolKind.VARIABLE,
                    name=name,
                    qualified_name=name,
                    start_line=spec.start_point[0] + 1,
                    end_line=spec.end_point[0] + 1,
                    language=language,
                    parent_symbol_id=module_id,
                    references=[pointee] if pointee else [],
                )
            )
    return symbols


class GoAnalyzer:
    """LanguageAnalyzer implementation for Go source files."""

    language = "go"
    extensions = (".go",)

    def class_shapes(self, file_path: str, source: bytes) -> dict[str, ClassShape] | None:
        """The port's shape hook -- delegates to this module's extractor."""
        return extract_class_shapes(file_path, source)

    def resolve_import(self, import_text: str, importer_file: str, repo_root: Path) -> str | None:
        """Repo-relative package directory an import resolves to, via the nearest `go.mod`."""
        return _resolve_go_import(import_text, importer_file, repo_root)

    def parse(self, file_path: str, source: bytes) -> list[Symbol]:
        root = Parser(_LANGUAGE).parse(source).root_node
        dotted = module_dotted_path(file_path)
        module_doc = leading_doc_comment(_module_doc_anchor(root), source, _DOC_STYLE)
        module = module_symbol(
            root, file_path, self.language, dotted, _parse_imports(root, source), module_doc
        )
        # No `module.is_exported`: Go packages aren't capitalization-gated like identifiers.
        symbols = [module]
        symbols.extend(_package_pointer_vars(root, file_path, self.language, module.id, source))
        type_ids: dict[str, str] = {}

        for node in root.children:
            if node.type == "type_declaration":
                # The doc comment precedes the outer type_declaration, not the inner type_spec.
                type_doc = leading_doc_comment(node, source, _DOC_STYLE)
                for spec in node.children:
                    if spec.type != "type_spec":
                        continue
                    name_node = spec.child_by_field_name("name")
                    if name_node is None:
                        continue
                    name = node_text(name_node, source)
                    type_id = f"{file_path}::class::{name}"
                    type_ids[name] = type_id
                    calls: list[str] = []
                    collect_calls(spec, source, calls, _CALLS)
                    symbols.append(
                        Symbol(
                            id=type_id,
                            file_path=file_path,
                            kind=SymbolKind.CLASS,
                            name=name,
                            qualified_name=name,
                            start_line=spec.start_point[0] + 1,
                            end_line=spec.end_point[0] + 1,
                            language=self.language,
                            parent_symbol_id=module.id,
                            references=calls,
                            docstring=type_doc,
                            is_exported=_is_exported(name),
                        )
                    )

        for node in root.children:
            if node.type not in ("function_declaration", "method_declaration"):
                continue
            name_node = node.child_by_field_name("name")
            if name_node is None:
                continue
            name = node_text(name_node, source)
            receiver_type = (
                _receiver_type_name(node, source)
                if node.type == "method_declaration"
                else None
            )
            qualname = f"{receiver_type}.{name}" if receiver_type else name
            calls = []
            qualified: list[tuple[str, str]] = []
            assigned: list[str] = []
            body = node.child_by_field_name("body")
            statements = _go_body_statements(body) if body is not None else []
            if body is not None:
                collect_calls(body, source, calls, _CALLS, qualified)
                _collect_assigned_identifiers(body, source, assigned)
            symbols.append(
                function_symbol(
                    node, file_path, self.language, name, qualname,
                    type_ids.get(receiver_type or "", module.id), calls, statements,
                    assigned_identifiers=assigned,
                    docstring=leading_doc_comment(node, source, _DOC_STYLE),
                    is_exported=_is_exported(name),
                    qualified_references=qualified,
                )
            )

        return symbols


def _type_name(type_node: Node | None, source: bytes) -> str | None:
    """Base type name for a field/embed, unwrapping `*T` and `pkg.T` down to `T`."""
    if type_node is None:
        return None
    if type_node.type == "type_identifier":
        return node_text(type_node, source)
    if type_node.type == "pointer_type":
        inner = next((c for c in type_node.children if c.is_named), None)
        return _type_name(inner, source)
    if type_node.type == "qualified_type":
        name_node = type_node.child_by_field_name("name")
        return node_text(name_node, source) if name_node is not None else None
    return None


def _field_kind(type_node: Node | None) -> str:
    """Go analog of Python's `_attr_value_kind`: map/slice/pointer/other from the field's type."""
    if type_node is None:
        return "other"
    if type_node.type == "map_type":
        return "map"
    if type_node.type == "slice_type":
        return "slice"
    if type_node.type == "pointer_type":
        return "pointer"
    return "other"


def _collect_struct_body(
    body: Node, source: bytes, class_attrs: dict[str, str], bases: list[str]
) -> None:
    for field_decl in body.children:
        if field_decl.type != "field_declaration":
            continue
        type_node = field_decl.child_by_field_name("type")
        names = [c for c in field_decl.children if c.type == "field_identifier"]
        if not names:
            # No name -- an anonymous embedded field, Go's closest analog to a base class.
            base = _type_name(type_node, source)
            if base is not None:
                bases.append(base)
            continue
        for name_node in names:
            class_attrs[node_text(name_node, source)] = _field_kind(type_node)


def _collect_interface_methods(
    interface_node: Node, source: bytes, methods: dict[str, MethodShape]
) -> None:
    for method_elem in interface_node.children:
        if method_elem.type != "method_elem":
            continue
        name_node = method_elem.child_by_field_name("name")
        if name_node is not None:
            methods[node_text(name_node, source)] = MethodShape()


def _receiver_attr_name(node: Node | None, recv_name: str, source: bytes) -> str | None:
    """`<recv_name>.Field` -> `"Field"`, the Go analog of Python's `self.X` attr access."""
    if node is None or node.type != "selector_expression":
        return None
    operand = node.child_by_field_name("operand")
    field = node.child_by_field_name("field")
    if operand is None or field is None or operand.type != "identifier":
        return None
    if node_text(operand, source) != recv_name:
        return None
    return node_text(field, source)


def _is_append_call(value: Node, attr: str, recv_name: str, source: bytes) -> bool:
    """True for `append(<recv_name>.<attr>, ...)` -- Go's builtin-function analog of `.append()`."""
    if value.type != "call_expression":
        return False
    func = value.child_by_field_name("function")
    if func is None or func.type != "identifier" or node_text(func, source) != "append":
        return False
    arguments = value.child_by_field_name("arguments")
    if arguments is None:
        return False
    first_arg = next((c for c in arguments.children if c.is_named), None)
    return first_arg is not None and _receiver_attr_name(first_arg, recv_name, source) == attr


def _expression_list_items(node: Node | None) -> list[Node]:
    if node is None:
        return []
    children = node.children if node.type == "expression_list" else [node]
    return [c for c in children if c.is_named]


def _handle_go_assignment(
    left: Node | None, right: Node | None, source: bytes, shape: MethodShape, recv_name: str
) -> None:
    lefts = _expression_list_items(left)
    rights = _expression_list_items(right)
    for i, target in enumerate(lefts):
        value = rights[i] if i < len(rights) else None
        if target.type == "index_expression":
            operand = target.child_by_field_name("operand")
            attr = _receiver_attr_name(operand, recv_name, source)
            if attr is not None:
                shape.writes_dict_attrs.append(attr)
            continue
        attr = _receiver_attr_name(target, recv_name, source)
        is_append = value is not None and _is_append_call(value, attr or "", recv_name, source)
        if attr is not None and is_append:
            shape.appends_list_attrs.append(attr)


def _handle_go_attribute_call(
    node: Node, source: bytes, shape: MethodShape, recv_name: str
) -> None:
    func = node.child_by_field_name("function")
    if func is None or func.type != "selector_expression":
        return
    obj = func.child_by_field_name("operand")
    method = func.child_by_field_name("field")
    if obj is None or method is None:
        return
    attr = _receiver_attr_name(obj, recv_name, source)
    if attr is None:
        return
    shape.calls_on_attr.setdefault(attr, []).append(node_text(method, source))


def _handle_go_index_read(node: Node, source: bytes, shape: MethodShape, recv_name: str) -> None:
    operand = node.child_by_field_name("operand")
    attr = _receiver_attr_name(operand, recv_name, source) if operand is not None else None
    if attr is not None:
        shape.reads_dict_attrs.append(attr)


def _handle_go_range(node: Node, source: bytes, shape: MethodShape, recv_name: str) -> None:
    right = node.child_by_field_name("right")
    attr = _receiver_attr_name(right, recv_name, source) if right is not None else None
    if attr is not None:
        shape.iterates_attrs.append(attr)


def _walk_method_body(node: Node, source: bytes, shape: MethodShape, recv_name: str) -> None:
    """Fills `shape` from receiver-var usage in a method body -- Go's `collect_attribute_usage`."""
    if node.type in ("assignment_statement", "short_var_declaration"):
        left = node.child_by_field_name("left")
        right = node.child_by_field_name("right")
        _handle_go_assignment(left, right, source, shape, recv_name)
        for value in _expression_list_items(right):
            _walk_method_body(value, source, shape, recv_name)
        return
    if node.type == "call_expression":
        _handle_go_attribute_call(node, source, shape, recv_name)
    elif node.type == "index_expression":
        _handle_go_index_read(node, source, shape, recv_name)
    elif node.type == "range_clause":
        _handle_go_range(node, source, shape, recv_name)
    for child in node.children:
        _walk_method_body(child, source, shape, recv_name)


def extract_class_shapes(file_path: str, source: bytes) -> dict[str, ClassShape]:
    """One ClassShape per named type, keyed by the same id `GoAnalyzer.parse` assigns."""
    root = Parser(_LANGUAGE).parse(source).root_node
    shapes: dict[str, ClassShape] = {}
    type_ids: dict[str, str] = {}

    for node in root.children:
        if node.type != "type_declaration":
            continue
        for spec in node.children:
            if spec.type != "type_spec":
                continue
            name_node = spec.child_by_field_name("name")
            type_node = spec.child_by_field_name("type")
            if name_node is None or type_node is None:
                continue
            name = node_text(name_node, source)
            class_id = f"{file_path}::class::{name}"
            type_ids[name] = class_id
            bases: list[str] = []
            class_attrs: dict[str, str] = {}
            methods: dict[str, MethodShape] = {}
            if type_node.type == "struct_type":
                kind = "struct"
                body = next(
                    (c for c in type_node.children if c.type == "field_declaration_list"), None
                )
                if body is not None:
                    _collect_struct_body(body, source, class_attrs, bases)
            elif type_node.type == "interface_type":
                kind = "interface"
                _collect_interface_methods(type_node, source, methods)
            else:
                # Go allows methods on any defined type (e.g. `type Status int`); needs a shape.
                kind = "type"
            shapes[class_id] = ClassShape(
                symbol_id=class_id,
                bases=bases,
                is_abstract=(kind == "interface"),
                methods=methods,
                class_attrs=class_attrs,
                kind=kind,
            )

    for node in root.children:
        if node.type != "method_declaration":
            continue
        receiver_type = _receiver_type_name(node, source)
        owner_id = type_ids.get(receiver_type or "")
        if owner_id is None:
            continue
        name_node = node.child_by_field_name("name")
        if name_node is None:
            continue
        recv_var = _receiver_var_name(node, source)
        shape = MethodShape()
        body = node.child_by_field_name("body")
        if body is not None and recv_var is not None:
            _walk_method_body(body, source, shape, recv_var)
        shapes[owner_id].methods[node_text(name_node, source)] = shape

    return shapes
