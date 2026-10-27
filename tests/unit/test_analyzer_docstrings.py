"""Per-language doc-comment extraction, export flags and symbol parenting across the analyzers."""

import pytest

from codechroma.analyzers.c_analyzer import CAnalyzer
from codechroma.analyzers.cpp_analyzer import CppAnalyzer
from codechroma.analyzers.csharp_analyzer import CSharpAnalyzer
from codechroma.analyzers.go_analyzer import GoAnalyzer
from codechroma.analyzers.java_analyzer import JavaAnalyzer
from codechroma.analyzers.php_analyzer import PhpAnalyzer
from codechroma.analyzers.python_analyzer import PythonAnalyzer
from codechroma.analyzers.ruby_analyzer import RubyAnalyzer
from codechroma.analyzers.rust_analyzer import RustAnalyzer
from codechroma.analyzers.typescript_analyzer import TypeScriptAnalyzer
from codechroma.graph.models import SymbolKind
from tests.unit.analyzer_test_helpers import by_kind_name

M, C, F = SymbolKind.MODULE, SymbolKind.CLASS, SymbolKind.FUNCTION

_DOC_CASES = [
    (CAnalyzer, "m.c", b"/**\n * Adds.\n */\nint add(int a) {\n return a;\n}\n", F, "add", "Adds."),
    (CAnalyzer, "m.c", b"// Adds.\nint add(int a) {\n return a;\n}\n", F, "add", "Adds."),
    (
        RubyAnalyzer,
        "g.rb",
        b"# A greeter.\nclass Greeter\n  def hello\n    1\n  end\nend\n",
        C,
        "Greeter",
        "A greeter.",
    ),
    (
        RubyAnalyzer,
        "g.rb",
        b"class Greeter\n  # Says hello.\n  def hello\n    1\n  end\nend\n",
        F,
        "Greeter.hello",
        "Says hello.",
    ),
    (
        CSharpAnalyzer,
        "G.cs",
        b"public class Greeter {\n    /// <summary>\n    /// Says hello.\n    /// </summary>\n"
        b"    public int Hello() { return 1; }\n}\n",
        F,
        "Greeter.Hello",
        "Says hello.",
    ),
    (
        CSharpAnalyzer,
        "G.cs",
        b"/// <summary>\n/// A greeter.\n/// </summary>\npublic class Greeter {\n"
        b"    public int Hello() { return 1; }\n}\n",
        C,
        "Greeter",
        "A greeter.",
    ),
    (
        JavaAnalyzer,
        "G.java",
        b"/**\n * A greeter.\n */\npublic class Greeter {\n int hi() { return 1; }\n}\n",
        C,
        "Greeter",
        "A greeter.",
    ),
    (
        JavaAnalyzer,
        "G.java",
        b"public class Greeter {\n    /**\n     * Says hello.\n     */\n"
        b"    public int hello() { return 1; }\n}\n",
        F,
        "Greeter.hello",
        "Says hello.",
    ),
    (
        PhpAnalyzer,
        "G.php",
        b"<?php\n/**\n * A greeter.\n */\nclass Greeter {\n"
        b"    public function hello() { return 1; }\n}\n",
        C,
        "Greeter",
        "A greeter.",
    ),
    (
        PhpAnalyzer,
        "G.php",
        b"<?php\nclass Greeter {\n    /**\n     * Says hello.\n     */\n"
        b"    public function hello() { return 1; }\n}\n",
        F,
        "Greeter.hello",
        "Says hello.",
    ),
    (
        CppAnalyzer,
        "g.hpp",
        b"/**\n * A greeter.\n */\nclass Greeter {\npublic:\n    int hello() { return 1; }\n};\n",
        C,
        "Greeter",
        "A greeter.",
    ),
    (
        CppAnalyzer,
        "g.h",
        b"/**\n * A greeter.\n */\nclass Greeter {\npublic:\n    int hello() { return 1; }\n};\n",
        C,
        "Greeter",
        "A greeter.",
    ),
    (
        RustAnalyzer,
        "widget.rs",
        b"//! Widget module.\n\npub fn hello() -> i32 { 1 }\n",
        M,
        "widget",
        "Widget module.",
    ),
    (RustAnalyzer, "widget.rs", b"/// A widget.\npub struct Widget {}\n", C, "Widget", "A widget."),
    (
        RustAnalyzer,
        "widget.rs",
        b"pub struct Widget {}\n\nimpl Widget {\n"
        b"    /// Says hello.\n    pub fn hello(&self) -> i32 { 1 }\n}\n",
        F,
        "Widget.hello",
        "Says hello.",
    ),
    (
        GoAnalyzer,
        "widget.go",
        b"// Package widget renders.\npackage widget\n\nfunc Helper() {}\n",
        M,
        "widget",
        "Package widget renders.",
    ),
    (
        GoAnalyzer,
        "widget.go",
        b"package widget\n\n// Widget is a thing.\ntype Widget struct{}\n",
        C,
        "Widget",
        "Widget is a thing.",
    ),
    (
        GoAnalyzer,
        "widget.go",
        b"package widget\n\ntype Widget struct{}\n\n"
        b"// Render draws.\nfunc (w *Widget) Render() {}\n",
        F,
        "Widget.Render",
        "Render draws.",
    ),
    (
        GoAnalyzer,
        "widget.go",
        b"package widget\n\n// Helper does.\n// No args.\nfunc Helper() {}\n",
        F,
        "Helper",
        "Helper does.\nNo args.",
    ),
    (
        TypeScriptAnalyzer,
        "mod.ts",
        b"/** File overview. */\nfunction plain() {}\n",
        M,
        "mod",
        "File overview.",
    ),
    (TypeScriptAnalyzer, "mod.ts", b"// A widget.\nclass Widget {}\n", C, "Widget", "A widget."),
    (
        TypeScriptAnalyzer,
        "mod.ts",
        b"class Widget {\n  /** Renders. */\n  render() {}\n}\n",
        F,
        "Widget.render",
        "Renders.",
    ),
    (
        TypeScriptAnalyzer,
        "mod.ts",
        b"/**\n * First.\n * Second.\n */\nfunction helper() {}\n",
        F,
        "helper",
        "First.\nSecond.",
    ),
    (PythonAnalyzer, "mod.py", b'"""Module summary."""\nx = 1\n', M, "mod", "Module summary."),
    (
        PythonAnalyzer,
        "mod.py",
        b'class Widget:\n    """A widget."""\n    pass\n',
        C,
        "Widget",
        "A widget.",
    ),
    (
        PythonAnalyzer,
        "mod.py",
        b'class Widget:\n    def render(self):\n        """Renders."""\n',
        F,
        "Widget.render",
        "Renders.",
    ),
    (
        PythonAnalyzer,
        "mod.py",
        b'def helper():\n    """First.\n\n    Second.\n    """\n',
        F,
        "helper",
        "First.\n\nSecond.",
    ),
    (
        PythonAnalyzer,
        "mod.py",
        b'@deco\nclass Widget:\n    """Decorated."""\n    pass\n',
        C,
        "Widget",
        "Decorated.",
    ),
]


@pytest.mark.parametrize(("analyzer", "path", "source", "kind", "name", "expected"), _DOC_CASES)
def test_doc_comment_is_extracted(analyzer, path, source, kind, name, expected):
    symbols = analyzer().parse(path, source)

    assert by_kind_name(symbols, kind, name).docstring == expected


_NO_DOC_CASES = [
    (CAnalyzer, "m.c", b"int add(int a) {\n return a;\n}\n", F, "add"),
    (RubyAnalyzer, "g.rb", b"class Greeter\n  def hello\n    1\n  end\nend\n", F, "Greeter.hello"),
    (
        CSharpAnalyzer,
        "G.cs",
        b"public class Greeter {\n public int Hello() { return 1; }\n}\n",
        F,
        "Greeter.Hello",
    ),
    (
        JavaAnalyzer,
        "G.java",
        b"public class Greeter {\n public int hello() { return 1; }\n}\n",
        F,
        "Greeter.hello",
    ),
    (
        PhpAnalyzer,
        "G.php",
        b"<?php\nclass Greeter {\n public function hello() { return 1; }\n}\n",
        F,
        "Greeter.hello",
    ),
    (
        CppAnalyzer,
        "g.hpp",
        b"class Greeter {\npublic:\n    int hello() { return 1; }\n};\n",
        F,
        "Greeter.hello",
    ),
    (RustAnalyzer, "widget.rs", b"pub fn hello() -> i32 { 1 }\n", F, "hello"),
    (GoAnalyzer, "widget.go", b"package widget\n\nfunc Helper() {}\n", M, "widget"),
    (
        GoAnalyzer,
        "widget.go",
        b"package widget\n\n// Unrelated.\n\nfunc Helper() {}\n",
        F,
        "Helper",
    ),
    (TypeScriptAnalyzer, "mod.ts", b"function helper() {}\n", F, "helper"),
    (PythonAnalyzer, "mod.py", b"x = 1\n", M, "mod"),
    (PythonAnalyzer, "mod.py", b"def helper():\n    return 1\n", F, "helper"),
]


@pytest.mark.parametrize(("analyzer", "path", "source", "kind", "name"), _NO_DOC_CASES)
def test_symbol_without_doc_comment_is_none(analyzer, path, source, kind, name):
    symbols = analyzer().parse(path, source)

    assert by_kind_name(symbols, kind, name).docstring is None


@pytest.mark.parametrize(
    ("analyzer", "path", "source", "kind", "name", "expected"),
    [
        (GoAnalyzer, "w.go", b"package w\n\nfunc Helper() {}\n", F, "Helper", True),
        (GoAnalyzer, "w.go", b"package w\n\nfunc helper() {}\n", F, "helper", False),
        (GoAnalyzer, "w.go", b"package w\n\ntype Widget struct{}\n", C, "Widget", True),
        (
            TypeScriptAnalyzer,
            "m.ts",
            b"/** D. */\nexport function helper() {}\n",
            F,
            "helper",
            True,
        ),
        (TypeScriptAnalyzer, "m.ts", b"export class Widget {}\n", C, "Widget", True),
        (TypeScriptAnalyzer, "m.ts", b"export const helper = () => {};\n", F, "helper", True),
        (TypeScriptAnalyzer, "m.ts", b"function helper() {}\n", F, "helper", False),
        (TypeScriptAnalyzer, "m.ts", b"const helper = () => {};\n", F, "helper", False),
    ],
)
def test_export_flag(analyzer, path, source, kind, name, expected):
    symbols = analyzer().parse(path, source)

    assert by_kind_name(symbols, kind, name).is_exported is expected


@pytest.mark.parametrize(
    ("analyzer", "path", "source", "child", "parent"),
    [
        (
            JavaAnalyzer,
            "G.java",
            b"public class Greeter {\n public Greeter(String n) { this.n = n; }\n}\n",
            "Greeter.Greeter",
            "Greeter",
        ),
        (
            PhpAnalyzer,
            "G.php",
            b"<?php\ntrait Greetable {\n public function hello() { return 1; }\n}\n",
            "Greetable.hello",
            "Greetable",
        ),
        (
            CppAnalyzer,
            "g.cpp",
            b"class Greeter {\npublic:\n int hello(int x);\n};\n\n"
            b"int Greeter::hello(int x) {\n return x;\n}\n",
            "Greeter.hello",
            "Greeter",
        ),
    ],
    ids=["java-constructor", "php-trait-method", "cpp-out-of-line-method"],
)
def test_method_is_parented_to_its_class(analyzer, path, source, child, parent):
    symbols = analyzer().parse(path, source)

    assert by_kind_name(symbols, F, child).parent_symbol_id == by_kind_name(symbols, C, parent).id


def test_rust_function_inside_nested_mod_is_captured():
    symbols = RustAnalyzer().parse("widget.rs", b"mod tests {\n    fn it_works() -> i32 { 1 }\n}\n")

    assert by_kind_name(symbols, F, "it_works").start_line == 2


@pytest.mark.parametrize(
    ("source", "names"),
    [
        (b"BASE_DIR = 1\n", {"BASE_DIR"}),
        (b'ENV_FILE: str = "x"\n', {"ENV_FILE"}),
        (b"a, b = 1, 2\n", {"a", "b"}),
        (b"def helper():\n    local = 1\n", set()),
        (b"class Widget:\n    attr = 1\n", set()),
    ],
    ids=["simple", "annotated", "tuple", "function-body-ignored", "class-body-ignored"],
)
def test_python_module_variables(source, names):
    symbols = PythonAnalyzer().parse("mod.py", source)

    assert {s.name for s in symbols if s.kind == SymbolKind.VARIABLE} == names
