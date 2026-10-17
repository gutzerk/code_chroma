# 011 - C# graph core (GraphBuilder, dependency digest, clustering)

Status: **In progress**

Plan 1 of the four-part C# migration (graph core -> bridge -> shell -> canvas). The Python code stays
the reference implementation; nothing in `src/codechroma/` is deleted by this change.

Target is **.NET 8** (`net8.0`), the SDK installed on the dev machines. Nothing in the core needs
.NET 10 features, so moving the `TargetFramework` later is a one-line change.

## Scope

| Ported to `dotnet/CodeChroma.Core` | Python source |
|---|---|
| Models, `GraphBuilder`, `GraphDiffer` | `graph/models.py`, `graph/builder.py`, `GraphStore.diff` |
| Dependency index, digest, digest persistence | `dependencies/digest.py` |
| Component/container clustering | `dependencies/clustering.py` |
| Folder/file structure menu | `context/structure.py` |
| C1 context digest | `context/digest.py` |
| `GraphCore` (analyze/reanalyze/accessors) | the graph half of `engine.py` |

Out of scope here: analyzers (stay Python), the SQLite store (stays Python; only its `diff()` moved),
the summarizer, the bridge routes.

## Step 0 - baseline (Python, Windows 11, Python 3.14.7, 5 runs, median)

Measured with `scripts/bench_graph_core.py` (new) and `scripts/bench_analyze.py`.

| Repo | analyze() | reanalyze(1 file) |
|---|---|---|
| `sample_repo` | 30.5 ms | 7.6 ms |
| `polyglot_repo` | 29.0 ms | 5.5 ms |
| `c0_import_resolution` | 30.4 ms | 5.5 ms |
| `wiki_general_clustering` | 33.5 ms | 8.5 ms |
| synthetic 53k-line / 200-file repo (`bench_analyze.py`) | 3.61 s wall clock (limit 300 s) | not measured |

Profile of `analyze()` on the 53k-line repo (cProfile, 2.86 s under the profiler):

| Stage | Time | Share |
|---|---|---|
| tree-sitter parse + class shapes (`_parse_file_or_none`) | 1.44 s | 50% |
| `SqliteGraphStore.save` (full delete + reinsert) | 0.84 s | 29% |
| summaries | 0.24 s | 8% |
| **GraphBuilder.build** | **0.13 s** | **4.5%** |
| **Dependency digest** | **0.11 s** | **4%** |

Finding, recorded honestly: **the three components being ported are about 8% of an analyze run.**
The plan's rule ("a plan is only continued if the baseline shows a real bottleneck") is therefore
*not* met on speed for this slice. The real costs are parsing (native tree-sitter, not ported here) and
the full-rewrite SQLite save (a language-independent fix that could land in Python first). The
slice was still built, as instructed, because it is the seam that lets the later plans (bridge, shell)
drop the Python runtime; its justification is packaging and a typed contract, not speed. Peak RSS and
cold start are not measured yet (see "What remains").

## Step 1 - test audit

The three questions: (1) does it assert behaviour a user or neighbouring component can observe?
(2) does another test already cover it? (3) is it tied to Python or its mocks?

| Python test file | Tests | Verdict | C# home |
|---|---|---|---|
| `test_graph_builder` | 6 | **Merged** into one `[Theory]` over 5 doc_only cases (the "component never doc_only" test became an invariant inside every case) | `GraphBuilderTests.DocOnly_*` |
| `test_c0_import_resolution` | 4 | **Merged** into one `[Theory]`; now fed by the analyzer's pre-resolved import table instead of running analyzers | `GraphBuilderTests.CrossFileCalls_*` |
| `integration/test_initial_hierarchy_generation` | 5 | **Kept**, rewritten against `Graph` (no store/engine); `analyze_succeeds` moved to `GraphCoreTests`; the two "walk all descendants" tests merged into two graph-invariant tests | `GraphBuilderTests.Hierarchy_*` |
| `integration/test_shared_node_multi_parent` | 3 | **Merged** into one `[Theory]` of 4 rows (adds the Pillar and System rows, which nothing asserted before) | `GraphBuilderTests.Hierarchy_Mirrors*` |
| `integration/test_incremental_reanalyze` | 3 | **Kept** as behaviour tests; inputs are the Python-exported edit scenarios (`reanalyze-*.json`) | `GraphCoreTests.Reanalyze_*` |
| `test_dependency_digest` | 6 | **Kept** 5; `round_trips_through_json` **dropped** (tests the JSON library, not our behaviour); `monkeypatch` of cap getters **rewritten** to a `DigestCaps` argument | `DependencyDigestTests` |
| `integration/test_dependency_digest_persistence` | 3 | **Rewritten**: write/load round trip, tolerant load (missing/malformed as a `[Theory]`), and "reanalyze rewrites digest" via the `IGraphSink` seam; the `monkeypatch(build_dependency_digest)` test became a throwing sink | `DependencyDigestTests`, `GraphCoreTests` |
| `test_wiki_general_clustering` | 15 funcs / 20 cases | **Merged**: 4 chain-step tests + container sharing -> one 5-row `[Theory]`; 3 "infra never placed" + 2 `is_infra_path` parametrized -> one 8-row `IsInfraPath` theory and one 3-row placement theory; manifest shape and reproducibility kept; undetermined-file and solo-container kept as-is | `ClusteringTests` |
| `test_context_structure` | 12 | **Merged** 6 budget/depth/root tests into one `[Theory]` table; ordering/paths/levels/no-source folded into one test; summary trimming parametrized; unknown root kept | `StructureTests` |
| `test_context_digest` | 6 funcs / 11 cases | **Merged**: pyproject, go.mod x6 and the concatenation case are one 9-row `[Theory]`; readme present/absent one `[Theory]`; field-shape kept; **added** `external_import_roots` (no Python test existed) | `ContextDigestTests` |
| `test_graph_store` | 11 | **Out of scope** (SQLite). Only the two `diff` tests move, as the parity test on `GraphDiffer` | `ParityTests.ReanalyzeDiff_*` |
| `contract/test_graph_engine_api` | 5 | **Rewritten**: method-surface/signature checks (language-bound, 3 tests) are replaced by the compile-time `IGraphCore` interface; "accessors safe before analysis" kept; "never calls sync_wiki" is a Python mock test, **dropped** (the core has no wiki) | `GraphCoreTests` |
| `contract/test_context_envelope` | 2 | **Dropped from this plan**: it is an HTTP route contract (`TestClient`); moves to Plan 2 | - |
| `test_bridge_dependency_digest_route`, `test_bridge_structure_route`, `test_bridge_c1_route::context_digest_*` | 3+4+1 | **Moved to Plan 2** (route level). `context_digest_reflects_the_fixture_repo` is a duplicate of the unit test and is dropped | - |

New tests with no Python precedent: logic-block splitting table (6 rows; only covered indirectly by
integration before), `FindRoute` incl. the 12-hop cap, `PluralityWinner`, `UndeterminedCandidates`,
`SymbolOrigin`, the analyzer-contract tests, and the **parity tests** (below).

## Step 2 - language-neutral golden export

`tests/graph_golden.py` (`poetry run python -m tests.graph_golden`) writes
`tests/fixtures/graph_golden/`:

- `<repo>.input.json`: **the analyzer-output contract**, `schema_version: 1`. Ordered `files[]`
  (`path`, `symbols` or `null` for an unparsed file), `import_resolutions` (importer -> dotted import ->
  repo path, i.e. the analyzer port's `resolve_import` answers pre-computed), and `summaries` (offline
  summarizer text, used only by the structure menu). Symbol fields are the Python `Symbol` fields in
  snake_case; `qualified_references` and `body_statements` are objects, not tuples.
- `<repo>.expected.json`: what Python produces from that input: `nodes` (builder order), `digest` and
  `digest_tight` (default and tiny caps, `generated_at` removed), `clusters` (incl. edge weights and
  undetermined candidates), `structure` (8 argument cases), `context_digest`.
- `sample_repo.reanalyze-{append_method,delete_file}.json`: before/after inputs plus the `GraphDiff`
  `reanalyze()` returned.

`tests/unit/test_graph_golden_export.py` fails if a committed golden drifts from what the engine
emits, so the goldens cannot silently go stale. Repos covered: `sample_repo`, `polyglot_repo`,
`c0_import_resolution`, `wiki_general_clustering`, `yaml_repo`, `repo_scan_exclusions`.

## Step 3 - C# core

`dotnet/CodeChroma.sln`: `CodeChroma.Core` (library) and `CodeChroma.Core.Tests` (xUnit). Run
`dotnet test dotnet`. The tests were committed **red first** (every one failing with
`NotImplementedException` against API stubs) before any implementation was written.

## Removal candidates (NOT removed; only after parity is reviewed and Plans 2+ no longer call them)

`graph/builder.py`, `dependencies/digest.py`, `dependencies/clustering.py`, `context/digest.py`,
`context/structure.py`, the `GraphBuilder`/digest imports in `engine.py`, and their unit tests
(`test_graph_builder`, `test_dependency_digest`, `test_wiki_general_clustering`,
`test_context_structure`, `test_context_digest`, `test_c0_import_resolution` once the goldens carry
the same cases). `graph/models.py` stays until the store and analyzers are ported.

## What remains

(Filled in when the implementation is complete.)
