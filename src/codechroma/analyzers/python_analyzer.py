"""Python LanguageAnalyzer backed by py-tree-sitter + tree-sitter-python."""

from __future__ import annotations

import tomllib
from pathlib import Path

import tree_sitter_python as tspython
from tree_sitter import Language, Node, Parser

from codechroma.analyzers.tree_sitter_common import (
    AttributeSpec,
    CallSpec,
    body_statements,
    class_symbol,
    collect_attribute_usage,
    collect_calls,
    confined_relpath,
    find_ancestor_file,
    function_symbol,
    leading_docstring,
    module_dotted_path,
    module_symbol,
    node_text,
)
from codechroma.graph.models import ClassShape, MethodShape, Symbol, SymbolKind

_LANGUAGE = Language(tspython.language())
_CALLS = CallSpec(
    call_type="call", member_type="attribute", member_field="attribute", object_field="object"
)
_ATTRS = AttributeSpec(
    assignment_type="assignment",
    subscript_type="subscript",
    attribute_type="attribute",
    call_type="call",
    for_type="for_statement",
    comparison_type="comparison_operator",
    none_type="none",
)


def _parse_imports(root: Node, source: bytes) -> dict[str, str]:
    imports: dict[str, str] = {}
    for node in root.children:
        if node.type == "import_from_statement":
            module_node = node.child_by_field_name("module_name")
            module = node_text(module_node, source) if module_node is not None else ""
            module_span = (
                (module_node.start_byte, module_node.end_byte) if module_node is not None else None
            )
            for child in node.children:
                child_span = (child.start_byte, child.end_byte)
                if child.type in ("dotted_name", "identifier") and child_span != module_span:
                    imports[node_text(child, source)] = module
                elif child.type == "aliased_import":
                    name_node = child.child_by_field_name("name")
                    alias_node = child.child_by_field_name("alias")
                    if name_node is not None and alias_node is not None:
                        imports[node_text(alias_node, source)] = module
        elif node.type == "import_statement":
            for child in node.children:
                if child.type in ("dotted_name", "identifier"):
                    imports[node_text(child, source)] = node_text(child, source)
                elif child.type == "aliased_import":
                    name_node = child.child_by_field_name("name")
                    alias_node = child.child_by_field_name("alias")
                    if name_node is not None and alias_node is not None:
                        imports[node_text(alias_node, source)] = node_text(name_node, source)
    return imports


def _poetry_package_root(pyproject_path: Path, pyproject_dir_rel: Path, dotted_first: str) -> Path:
    """Repo-relative dir `dotted_first`'s top segment lives under, per `[tool.poetry.packages]`."""
    try:
        data = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError):
        return pyproject_dir_rel
    packages = data.get("tool", {}).get("poetry", {}).get("packages", [])
    for entry in packages:
        if isinstance(entry, dict) and entry.get("include") == dotted_first:
            from_dir = entry.get("from")
            return pyproject_dir_rel / from_dir if from_dir else pyproject_dir_rel
    return pyproject_dir_rel


def _candidate_module_file(repo_root: Path, module_stem: Path) -> str | None:
    """`<module_stem>.py` if it exists, else `<module_stem>/__init__.py` if that does, else None."""
    if confined_relpath(module_stem.as_posix()) is None:
        return None
    py_file = Path(f"{module_stem.as_posix()}.py")
    if (repo_root / py_file).is_file():
        return py_file.as_posix()
    init_file = module_stem / "__init__.py"
    if (repo_root / init_file).is_file():
        return init_file.as_posix()
    return None


def _resolve_python_import(import_text: str, importer_file: str, repo_root: Path) -> str | None:
    repo_root = repo_root.resolve()
    importer_dir = Path(importer_file).parent
    pyproject = find_ancestor_file(repo_root / importer_dir, repo_root, "pyproject.toml")

    if import_text.startswith("."):
        level = len(import_text) - len(import_text.lstrip("."))
        remainder = import_text[level:]
        base_dir = importer_dir
        for _ in range(level - 1):
            base_dir = base_dir.parent
        if not remainder:
            init_file = confined_relpath((base_dir / "__init__.py").as_posix())
            if init_file is None:
                return None
            return init_file if (repo_root / init_file).is_file() else None
        module_stem = base_dir.joinpath(*remainder.split("."))
        return _candidate_module_file(repo_root, module_stem)

    parts = [p for p in import_text.split(".") if p]
    if not parts:
        return None
    if pyproject is not None:
        pyproject_dir_rel = pyproject.parent.relative_to(repo_root)
        package_root = _poetry_package_root(pyproject, pyproject_dir_rel, parts[0])
    else:
        package_root = Path()
    module_stem = package_root.joinpath(*parts)
    return _candidate_module_file(repo_root, module_stem)


class PythonAnalyzer:
    """LanguageAnalyzer implementation for Python source files."""

    language = "python"
    extensions = (".py",)

    def class_shapes(self, file_path: str, source: bytes) -> dict[str, ClassShape] | None:
        """The port's shape hook -- delegates to this module's extractor."""
        return extract_class_shapes(file_path, source)

    def resolve_import(self, import_text: str, importer_file: str, repo_root: Path) -> str | None:
        """Repo-relative `<path>.py`/`<path>/__init__.py` an import resolves to, else None."""
        return _resolve_python_import(import_text, importer_file, repo_root)

    def parse(self, file_path: str, source: bytes) -> list[Symbol]:
        root = Parser(_LANGUAGE).parse(source).root_node
        dotted = module_dotted_path(file_path, strip_init=True)
        module = module_symbol(
            root,
            file_path,
            self.language,
            dotted,
            _parse_imports(root, source),
            leading_docstring(root, source),
        )
        symbols = [module]

        def visit(node: Node, enclosing_qualname: str | None, parent_id: str) -> None:
            for child in node.children:
                if child.type == "class_definition":
                    class_calls: list[str] = []
                    class_qualified: list[tuple[str, str]] = []
                    collect_calls(child, source, class_calls, _CALLS, class_qualified)
                    symbol = class_symbol(
                        child,
                        source,
                        file_path,
                        self.language,
                        enclosing_qualname,
                        parent_id,
                        class_calls,
                        leading_docstring(child.child_by_field_name("body"), source),
                        qualified_calls=class_qualified,
                    )
                    symbols.append(symbol)
                    visit(child, symbol.qualified_name, symbol.id)
                elif child.type == "function_definition":
                    name_node = child.child_by_field_name("name")
                    name = node_text(name_node, source) if name_node is not None else "<anonymous>"
                    qualname = f"{enclosing_qualname}.{name}" if enclosing_qualname else name
                    func_id = f"{file_path}::function::{qualname}"
                    calls: list[str] = []
                    qualified: list[tuple[str, str]] = []
                    body = child.child_by_field_name("body")
                    statements = body_statements(body) if body is not None else []
                    if body is not None:
                        collect_calls(body, source, calls, _CALLS, qualified)
                    symbols.append(
                        function_symbol(
                            child, file_path, self.language, name, qualname,
                            parent_id, calls, statements,
                            docstring=leading_docstring(body, source),
                            qualified_references=qualified,
                        )
                    )
                    visit(child, qualname, func_id)
                else:
                    visit(child, enclosing_qualname, parent_id)

        visit(root, None, module.id)
        symbols.extend(
            _module_level_variables(root, file_path, self.language, module.id, dotted, source)
        )
        return symbols


def _assignment_targets(left: Node, source: bytes) -> list[str]:
    """Identifier names `left` assigns to -- plain/annotated single target, or tuple-unpacked."""
    if left.type == "identifier":
        return [node_text(left, source)]
    if left.type == "pattern_list":
        return [node_text(c, source) for c in left.children if c.type == "identifier"]
    return []


def _module_level_variables(
    root: Node, file_path: str, language: str, module_id: str, dotted: str, source: bytes
) -> list[Symbol]:
    """Module-level VARIABLE symbols, walking only `root.children` (no class/function bodies)."""
    symbols: list[Symbol] = []
    for stmt in root.children:
        if stmt.type != "expression_statement" or not stmt.children:
            continue
        assignment = stmt.children[0]
        if assignment.type != "assignment":
            continue
        left = assignment.child_by_field_name("left")
        if left is None:
            continue
        for name in _assignment_targets(left, source):
            symbols.append(
                Symbol(
                    id=f"{file_path}::variable::{name}",
                    file_path=file_path,
                    kind=SymbolKind.VARIABLE,
                    name=name,
                    qualified_name=f"{dotted}.{name}" if dotted else name,
                    start_line=stmt.start_point[0] + 1,
                    end_line=stmt.end_point[0] + 1,
                    language=language,
                    parent_symbol_id=module_id,
                )
            )
    return symbols


def _decorator_name(decorator_node: Node, source: bytes) -> str | None:
    for child in decorator_node.children:
        if child.type in ("identifier", "attribute"):
            return node_text(child, source)
        if child.type == "call":
            func = child.child_by_field_name("function")
            if func is not None:
                return node_text(func, source)
    return None


def _collect_decorators(decorated_node: Node, source: bytes) -> list[str]:
    return [
        name
        for child in decorated_node.children
        if child.type == "decorator" and (name := _decorator_name(child, source)) is not None
    ]


def _decorated_target(node: Node, source: bytes) -> tuple[Node, list[str]]:
    """Unwraps `@deco\\nclass X: ...` to (the real class/function definition, its decorators)."""
    if node.type != "decorated_definition":
        return node, []
    decorators = _collect_decorators(node, source)
    inner = node.child_by_field_name("definition")
    return (inner, decorators) if inner is not None else (node, decorators)


def _collect_bases(class_node: Node, source: bytes) -> list[str]:
    superclasses = class_node.child_by_field_name("superclasses")
    if superclasses is None:
        return []
    return [
        node_text(child, source)
        for child in superclasses.children
        if child.type in ("identifier", "attribute")
    ]


def _attr_value_kind(node: Node) -> str:
    if node.type == "dictionary":
        return "dict"
    if node.type == "list":
        return "list"
    if node.type == "none":
        return "none"
    return "other"


def _collect_class_attr(stmt: Node, class_attrs: dict[str, str], source: bytes) -> None:
    node = stmt.children[0] if stmt.children else None
    if node is None or node.type != "assignment":
        return
    left = node.child_by_field_name("left")
    right = node.child_by_field_name("right")
    if left is not None and left.type == "identifier" and right is not None:
        class_attrs[node_text(left, source)] = _attr_value_kind(right)


def _collect_class_body(
    body: Node, source: bytes, methods: dict[str, MethodShape], class_attrs: dict[str, str]
) -> None:
    for child in body.children:
        target, decorators = _decorated_target(child, source)
        if target.type == "function_definition":
            name_node = target.child_by_field_name("name")
            name = node_text(name_node, source) if name_node is not None else "<anonymous>"
            shape = MethodShape(decorators=decorators)
            method_body = target.child_by_field_name("body")
            if method_body is not None:
                collect_attribute_usage(method_body, source, shape, _ATTRS)
            methods[name] = shape
        elif target.type == "expression_statement":
            _collect_class_attr(target, class_attrs, source)


def extract_class_shapes(file_path: str, source: bytes) -> dict[str, ClassShape]:
    """One ClassShape per class in the file, keyed by the same id `PythonAnalyzer.parse` assigns."""
    root = Parser(_LANGUAGE).parse(source).root_node
    shapes: dict[str, ClassShape] = {}

    def visit(node: Node, enclosing_qualname: str | None) -> None:
        for child in node.children:
            target, decorators = _decorated_target(child, source)
            if target.type == "class_definition":
                name_node = target.child_by_field_name("name")
                name = node_text(name_node, source) if name_node is not None else "<anonymous>"
                qualname = f"{enclosing_qualname}.{name}" if enclosing_qualname else name
                class_id = f"{file_path}::class::{qualname}"
                bases = _collect_bases(target, source)
                methods: dict[str, MethodShape] = {}
                class_attrs: dict[str, str] = {}
                body = target.child_by_field_name("body")
                if body is not None:
                    _collect_class_body(body, source, methods, class_attrs)
                is_abstract = "ABC" in bases or any(
                    "abstractmethod" in m.decorators for m in methods.values()
                )
                shapes[class_id] = ClassShape(
                    symbol_id=class_id,
                    bases=bases,
                    decorators=decorators,
                    is_abstract=is_abstract,
                    methods=methods,
                    class_attrs=class_attrs,
                )
                visit(target, qualname)
            elif target.type == "function_definition":
                name_node = target.child_by_field_name("name")
                name = node_text(name_node, source) if name_node is not None else "<anonymous>"
                qualname = f"{enclosing_qualname}.{name}" if enclosing_qualname else name
                visit(target, qualname)
            else:
                visit(child, enclosing_qualname)

    visit(root, None)
    return shapes
