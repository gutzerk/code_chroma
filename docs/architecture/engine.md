# GraphEngine pipeline (`src/codechroma/`)

`GraphEngine` (`engine.py`) is the sole public entry point other epics call. Pipeline per
`analyze()`/`reanalyze()` call:

0. **Repo scan** (`engine.py`'s `_iter_repo_files`) — `os.walk` pruned by the flat `IGNORED_DIRS`
   name set (`.git`, `node_modules`, `.codechroma`, IDE/OS clutter, ...) and `is_synced_skill_path`
   (`skills.py`, the bridge's own `.claude/skills/codechroma-*` copies) — both unchanged. On top of
   those, `_build_exclusion_spec` builds one `pathspec` `PathSpec` (`"gitignore"` factory) from a
   small built-in noise list (`_BUILTIN_NOISE_PATTERNS = ("vendor/", "worktrees/")`, each matching at
   any depth) plus every real `.gitignore` found in the repo (`_discover_gitignore_files`, itself
   pruned by `IGNORED_DIRS`/the builtin patterns so it never descends into e.g. a huge
   `node_modules`). Each nested `.gitignore`'s lines are re-anchored under its own directory
   (`_rewrite_gitignore_line`: a leading `/` or an internal `/` anchors to that directory; a bare
   pattern gets a `**/` prefix so it matches at any depth under it, mirroring real `.gitignore`
   scoping) before being folded into the one merged spec. The spec prunes both `dirnames` (so an
   excluded directory is never descended into) and `filenames` during the same walk; one
   `logger.info` line reports the total excluded-path count. Fixed the finding behind this change:
   409 of 500 "detailed" dependency-digest slots on a real large repo (`lm-panel-monorepo`) were
   worktree copies / vendored JS, not real code. Tests: `tests/unit/test_repo_scan_exclusions.py`.
1. **Analyzers** (`analyzers/`) — `AnalyzerRegistry` (Strategy pattern) picks a `LanguageAnalyzer`
   by file extension. Eleven languages are registered. Ten are tree-sitter based: `python_analyzer.py`,
   `typescript_analyzer.py`, `go_analyzer.py` (the original three), plus `java_analyzer.py`,
   `csharp_analyzer.py`, `rust_analyzer.py`, `php_analyzer.py`, `ruby_analyzer.py`,
   `c_analyzer.py`, `cpp_analyzer.py` (epic 031). The eleventh, `yaml_analyzer.py` (plan 050), parses
   with `pyyaml`'s `yaml.compose()` instead: YAML has no grammar-level node type for "this is a job"
   (that's determined by key name and tree position, not node kind), so the shared
   `tree_sitter_common.walk_classes_and_functions` harness would need a custom walk regardless, and
   `compose()`'s `MappingNode`/`SequenceNode`/`ScalarNode` tree gives the same thing more simply,
   without adding `tree-sitter-yaml` as a dependency.
   Each analyzer parses one file into flat `Symbol` records (module/class/function/variable) with
   resolved `references` (names called/used) and `imports` (local name → dotted module path), plus
   per-function `body_statements` used later for logic-block splitting.
   🔴 The port has **three** methods: `parse()`, `class_shapes()` (attribute/method shapes feeding
   `patterns/detector.py`; return `None` for a language with no extractor — TypeScript and
   `yaml_analyzer.py` do, and so do all seven epic-031 languages: pattern detection stays scoped to
   Python/Go for now), and `resolve_import(import_text, importer_file, repo_root) -> str | None` —
   the repo-relative file (or, for Go, package directory) an import resolves to on disk, or `None`
   when it isn't a local file (a stdlib/third-party import, a `tsconfig` path alias, an unresolvable
   relative import). Only `PythonAnalyzer`, `GoAnalyzer`, `TypeScriptAnalyzer` give a real answer —
   the other eight `LanguageAnalyzer`s return `None` unconditionally, the same "trivial per-language
   implementation, zero conditional branching in shared code" shape `class_shapes()` already
   established. `PythonAnalyzer.resolve_import` walks up to the nearest `pyproject.toml`
   (`find_ancestor_file`, `tree_sitter_common.py`) via `tomllib`, honors `[tool.poetry.packages]`'s
   `include`/`from` for a src-layout package root, and tries `<path>.py` then `<path>/__init__.py`.
   `GoAnalyzer.resolve_import` walks up to the nearest `go.mod`, matches the import path's prefix
   against the `module` directive, and resolves to a package **directory** (Go's import unit is a
   package, not one file). `TypeScriptAnalyzer.resolve_import` only handles relative specifiers
   (`./`, `../`; bare/package specifiers always `None`; `tsconfig` path aliases are out of scope),
   probing `.ts`/`.tsx`/`.js`/`.jsx` and `index.*`. 🔵 `CallSpec` (`tree_sitter_common.py`) gained an
   `object_field: str | None` (the grammar's field name for a qualified call's base — `"object"` for
   Python/TypeScript, `"operand"` for Go); `call_target_name` now returns `(qualifier, name)` instead
   of a bare name, and `collect_calls` takes an optional `qualified_out` list it also fills. Only
   Python/Go/TypeScript pass `object_field`/`qualified_out` through; `Symbol.qualified_references:
   list[tuple[str, str]]` (sibling to `references`) carries the result. A chain (`a.b.c()`) or an
   instance call (`self.foo()`/`this.foo()`/a local variable) never resolves — the qualifier's raw
   text is simply never a key in `Symbol.imports`, so no special-case name list is needed. Tests:
   `tests/unit/test_c0_import_resolution.py`.
   `engine.py` calls both **through the port only** — there is deliberately no
   `if analyzer.language == ...` ladder, so a 12th language is one registered analyzer with zero
   engine edits. `extensions` is a read-only property on the Protocol (a mutable attr is invariant
   under mypy, so a concrete `(".py",)` literal would never satisfy it).
   ⚠ `.h` is the one deliberate exception to "no two analyzers share an extension": `CppAnalyzer`
   claims it, `CAnalyzer` does not, so a C header parses (imperfectly, as C++) rather than falling
   back to a placeholder node — a known, accepted limitation, not a bug.
   Several new languages' call nodes don't share Go/TypeScript/Rust/C/C++'s "a `function` field
   points at either a bare identifier or a member-expression node" shape — Java's
   `method_invocation`, PHP's `member_call_expression`/`function_call_expression`, and Ruby's `call`
   all name their callee via their own `name`/`method` field directly, so those three analyzers walk
   calls with a small local collector instead of the shared `CallSpec`/`collect_calls` helper.
   ⚠ `yaml_analyzer.py` gives dialect-aware CLASS/FUNCTION names only to GitHub Actions workflows
   (root `jobs:` mapping → one CLASS per job, one FUNCTION per step) and composite/reusable actions
   (filename `action.yml`/`action.yaml` plus a `runs:` key → one CLASS for the file, one FUNCTION per
   step when `runs.using == composite`); Docker Compose, Kubernetes/Helm, and everything else get
   only a generic structural fallback (one CLASS per root key whose value is a mapping or a list of
   mappings). It never resolves `uses: ./relative/action` into a cross-file `depends_on_ids` edge —
   `_resolve_symbol_edges` below matches calls by name/dotted-import, which doesn't fit a path-based
   reference.
   `tests/contract/test_language_analyzer_contract.py` structurally checks every registered
   analyzer against the port.
2. **GraphBuilder** (`graph/builder.py`) — assembles the 7-level hierarchy as a **1:1 mirror of the
   real directory tree** (top-level dir → System, nested dir → Pillar, file → Component), then
   decomposes each file from its symbols:
   - Resolves symbol-level call/import edges first (`_resolve_symbol_edges`), then applies them as
     `depends_on_ids` (`_apply_dependency_edges`) — they annotate, they don't re-parent.
   - 🔴 `_resolve_symbol_edges` takes `build()`'s new `repo_root: Path | None`/`registry:
     AnalyzerRegistry | None` params (both optional, so `build()` still works standalone against a
     hand-built symbol dict with no cross-file resolution — most unit tests do exactly that). Cross-
     file resolution now calls `analyzer.resolve_import(...)` (via the registry, looked up by the
     *importing* file's extension) and looks the resulting path up among already-parsed files —
     **not** a string comparison of dotted names, which never matched in a src-layout project
     (confirmed empirically: 0 internal `codechroma` imports resolved before this fix). Two passes
     share one `resolve_target_index` closure: the original bare-name pass (`ref_name` found via
     `Symbol.imports`) and a new pass over `Symbol.qualified_references` (`m.z()` → `m` resolved via
     `Symbol.imports`, then `z` looked up in the resolved file). A `files_by_dir`/`dir_name_index`
     pair pools each directory's files' top-level names, so a `resolve_import` answer that names a
     **directory** (Go) still finds a name inside it, with no `if language == "go"` branch.
   - Structure follows the **filesystem, not code references**: a file lives only under its own
     directory node. Grouping by reference (union-find / multi-parenting) was removed — see the
     `builder.py` module docstring and `tests/integration/test_shared_node_multi_parent.py`, which
     pins "never re-parented under other directories just because their code references it."
   - Functions decompose into **Logic Block** children by splitting `body_statements` at control-flow
     boundaries (`_CONTROL_FLOW_LABELS`); runs of non-control statements become numbered "Step N"
     blocks. Each Logic Block gets one **Code** leaf child.
   - Files that fail to parse (or have no analyzer) still get identical childless placeholder
     Component nodes via `_add_component` (`placeholder_files = [fp for fp, syms in
     symbols_by_file.items() if syms is None]`) so the hierarchy stays complete.
3. **AISummarizer** (`summarize/ai_summarizer.py`) — one summary per node via Claude
   (`claude-3-5-haiku-latest`, `settings.ai_summarizer` in
   [`config.py`](config-and-prompts.md)), falling back to a deterministic templated string built from
   `_node_context()` (level/source/calls/imports) when no API key or the call fails. Its prompt
   template lives in `prompts/ai_summarizer.yaml`, not inline (see
   [`config-and-prompts.md`](config-and-prompts.md)). It produces a plain `AISummary(node_id,
   text, generated_at)` — no test/coverage stats are attached.
4. **GraphStore** (`graph/store.py`) — `Protocol` (Repository pattern), one `SqliteGraphStore` per
   repository (`.codechroma/graph.db` under the analyzed repo root, gitignored). Opening the store
   runs SQLite's `integrity_check`; repairable index damage is rebuilt with `REINDEX`, otherwise the
   corrupt cache is moved with its WAL/SHM sidecars into a timestamped
   `.codechroma/graph.db.corrupt-*` directory and rebuilt from source. `save()` does a full
   delete+reinsert per run rather than incremental upsert, and since the db is per repo it also drops
   rows under any other `repository_id` (a moved/copied checkout carries its old id and `nodes.id`
   is a global primary key). `diff()` compares two
   in-memory `Graph` snapshots (added/removed/reparented node IDs) — this is a value-level diff, not
   read from the DB.
5. **Dependency digest** (`dependencies/digest.py`) — reshapes the call/import edges `GraphBuilder`
   already resolved (`depends_on_ids`) into `DependencyIndex` (O(1) `dependents_of`/`dependencies_of`,
   consumed by `context/digest.py`'s C1 digest and `bridge/patterns_context.py`) and a capped
   file→class→function `build_dependency_digest`, persisted to `.codechroma/dependency-digest.json` on
   every `analyze()`/`reanalyze()` (`engine.py`'s `_write_dependency_digest()`; a digest failure is
   logged and swallowed, never fails the run; the C# `CoreGraphEngine` writes the same file after `Analyze`/`Reanalyze` with `DependencyDigest.Write`, swallowing errors the same way). Served via
   `GET /repos/{id}/dependency-digest[?path=<file>]` (`bridge/routes/graph.py`), which the
   `codechroma-draw-diagram` skill (c1/patterns types) uses to spot-check one file rather than
   fetching the whole digest. Tests: `tests/unit/test_dependency_digest.py`,
   `tests/integration/test_dependency_digest_persistence.py`,
   `tests/unit/test_bridge_dependency_digest_route.py`.

`reanalyze(changed_files)` requires a prior `analyze()` call on the same `GraphEngine` instance (raises
`RuntimeError` otherwise): it reuses previously-parsed symbols for unchanged files and only re-parses
`changed_files`, then reruns the same builder/summarizer/store pipeline over the merged symbol set.

Contract tests (`tests/contract/test_graph_engine_api.py`) assert `GraphEngine`'s public method
signatures against `contracts/graph-engine-api.md` — that spec file isn't present in this checkout
yet, so treat the contract test itself as the source of truth for the current API surface. Tests
are split `tests/unit/` (analyzers, store), `tests/integration/` (full analyze/reanalyze flows,
`tests/fixtures/sample_repo/`), `tests/contract/` (public API shape).

## C# graph core and parity tests (`dotnet/`, plan 011)

`dotnet/CodeChroma.Core` (net8.0) is a second implementation of the graph half of this pipeline:
`GraphBuilder` (step 2), `DependencyIndex`/`DependencyDigest` (step 5), `Clustering` and `GraphCore` (analyze/reanalyze/accessors). It does **not** run analyzers: it consumes the
analyzer-output JSON contract (`schema_version` 1: ordered `files[]` of symbols or `null`, pre-computed
`import_resolutions`, optional `summaries`). The Python code here stays the reference implementation and is
not removed yet; see [`docs/planning/011-csharp-graph-core.md`](../planning/011-csharp-graph-core.md) for the
baseline numbers, the test audit and what remains.

- 🔴 **Parity goldens**: `tests/fixtures/graph_golden/` is generated by `poetry run python -m tests.graph_golden`
  (`tests/graph_golden.py`) from the fixture repos. `tests/unit/test_graph_golden_export.py` fails when a
  committed golden no longer matches the engine, so changing builder/digest/clustering/structure output means
  regenerating the goldens in the same change. `dotnet test dotnet` (`ParityTests`) then diffs the C# output
  against them node for node.
- ⚠ Node order, dict insertion order and counter tie-breaks are part of the contract (C# reproduces them with
  `OrderedMap`/`Counter`); the digest's `generated_at` is the only field excluded from comparison.
- ⚠ `GraphCore.Reanalyze` only knows the import table it was given. Pass `new GraphCore(liveResolver: new LiveImportResolver(registry, root))`
  so every reanalyze re-resolves all imports against the live tree (like Python's `resolve_import` on each run); without it,
  creating `b.py` leaves an unchanged `a.py`'s `import b` unresolved. The graph and its `DependencyIndex` are published as one
  immutable pair, so readers never see a graph with another run's index.
- `scripts/bench_graph_core.py` times analyze/reanalyze on the fixtures; `--stages <repo> [dump.json]` times
  just builder, digest and clustering and dumps the contract JSON that `dotnet/CodeChroma.Bench` reads.

## C# design-pattern port (017)

`dotnet/CodeChroma.Core/Patterns/` ports `patterns/detector.py` + `serialize.py`: `PatternDetector.DetectCandidates(graph, shapes)`,
`PatternSerialize` (JSON shape, `FingerprintFor`) and `PatternsContext` (the skill's `{classes, heuristic_candidates}` payload).
🔴 `Graph` carries no class shapes in C# (unlike Python's `Graph.class_shapes`), so `ClassShapeExtractor` (Python + Go only, like
the Python side) re-reads source on demand; `CoreGraphEngine.PatternCandidates()`/`PatternsContext()` cache the result and drop it on
`Reanalyze`. This keeps the graph parity goldens untouched. Parity: `tests/fixtures/patterns_repo/` +
`python -m tests.pattern_golden` write `tests/fixtures/pattern_golden/*.expected.json`; `tests/unit/test_pattern_golden_export.py`
guards freshness and `PatternParityTests` (C#) must reproduce candidates and fingerprint byte for byte. Bridge side:
`Diagrams/PatternsResolver.cs` (port of `patterns_resolver.py`), `GET /repos/{id}/patterns` and `/patterns/context`.

## C# analyzer port

`dotnet/CodeChroma.Core/Analyzers/` mirrors `src/codechroma/analyzers/*` (tree-sitter via TreeSitter.DotNet, YAML via YamlDotNet), `_iter_repo_files` (`RepoScanner`) and the offline summarizer; the C# bridge uses it by default. Python stays the reference: change an analyzer here and in C# together and run `dotnet test dotnet` (parity against `tests/fixtures/graph_golden/*.input.json`). The live oracle test compares against `python -m codechroma.analysis_export` on any repo (`CODECHROMA_PYTHON`, `PYTHONPATH`, `CODECHROMA_ORACLE_REPO`); the bridge itself never shells out to Python (the `PythonAnalysisExporter` oracle lives in `CodeChroma.Bridge.Tests/Support`). The C# core has no structure builder (the bridge's `/structure` is built in `Routes/GraphRoutes.cs` from the engine) but does port `context/digest.py` as `ContextDigest.cs` (parity-tested against the goldens' `context_digest`; `ContextDigestTests`). The C# bridge serves `GET /repos/{id}/dependency-digest[?path=]`, `/context-digest` and `/route?from=&to=` from `GraphRoutes.cs`, always built fresh from the engine's graph snapshot (the C# bridge does not persist `.codechroma/dependency-digest.json`; tests: `Bridge.Tests/Skills/DigestRouteTests.cs`). Fixture repos have no external imports or manifests, so the golden only pins the empty shape; `ManifestsAndReadme_AreReadLikePython` covers pyproject/package.json/go.mod/README. Results and known grammar-version skew: `docs/planning/011-csharp-graph-core.md`, Phase 5.
