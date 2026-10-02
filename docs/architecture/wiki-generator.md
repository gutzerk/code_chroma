# Wiki generator (`src/codechroma/wiki/`) — the on-demand, docstring-only repo wiki

`GraphEngine.generate_wiki(output_dir=None)` (`engine.py`) is the only entry point — no bridge
route, no CLI subcommand, no canvas UI (FR-012). It raises `RuntimeError` if `analyze()` never ran
on that engine instance (same guard shape as `reanalyze()`), then forwards to the pure function
`wiki.generator.generate_wiki(graph, repo_root, output_dir)`, which takes the already-materialized
`Graph` directly rather than a `GraphEngine` — the same "bulk in-memory export" precedent
`dependencies/digest.py`'s `build_dependency_digest` already set, not the lazy `get_children()`
walk `context/digest.py` uses for a live browsing surface. This also lets unit tests build a small
hand-constructed `Graph`/`Symbol` set (`tests/unit/test_wiki_generator.py`) without a real
`analyze()` run. 🔴 `GraphEngine` itself — `analyze()`/`reanalyze()`/`_run_analysis` — never calls
wiki code; that stays a deliberate, separate action, and a live re-analysis must never write
`.codechroma/wiki/` as a side effect. As of 041-wiki-auto-bootstrap, one layer up, `Workspace.analyze()`
(`bridge/workspaces.py`) does call `generate_wiki()` once, via `bootstrap_wiki_if_missing()`
(`bridge/bootstrap_wiki.py`) — but only the first time a workspace comes up and only when
`.codechroma/wiki/index.md` doesn't exist yet and the workspace isn't read-only. Same
best-effort/never-fail-the-caller shape as `bootstrap_diagrams.py::bootstrap_if_missing`, but it
never reaches Anthropic (`generate_wiki()` is offline), so it lives in its own module rather than
the money-spending one. See `specs/022-wiki-generator/spec.md`'s amended FR-011/US3.

**Data model.** `Symbol` (`graph/models.py`) has a `docstring: str | None` field, populated by
`PythonAnalyzer` (FR-010) via `tree_sitter_common.leading_docstring(body, source)` — checks whether a
node's first child statement is a bare string expression, and `inspect.cleandoc()`s its text — and,
as of 030-wiki-language-breakdown, by `GoAnalyzer` and `TypeScriptAnalyzer` too, via the shared
`tree_sitter_common.CommentStyle` (frozen dataclass: `line_comment_type`, `line_prefix`,
`block_prefix`/`block_suffix`, `strip_line_leading_star`) + `leading_doc_comment(node, source, style)`
— walks contiguous `//`-comment prev-siblings (joining multi-line ones) or unwraps a single `/** */`
block, gated on line-adjacency so a blank-line-separated comment doesn't count as "directly above".
Both `tree-sitter-go` and `tree-sitter-typescript` use one `comment` node type for both comment forms
(no separate line/block node type), so `CommentStyle` distinguishes them by text prefix, not node
type. `go_analyzer.py`'s `_DOC_STYLE` is `//`-only; `typescript_analyzer.py`'s adds JSDoc
(`block_prefix="/**"`, `strip_line_leading_star=True`). Module-doc anchoring differs per language:
Go's doc comment precedes `package_clause` itself (`_module_doc_anchor` returns that node — Go's own
`// Package foo ...` convention, not the declaration after it); TS's precedes the first non-comment
top-level node in `program`. A type's (Go) or class's/function's (TS) doc comment can precede a
*wrapping* node, not the symbol node itself — Go's `type_spec` sits inside `type_declaration`, whose
own prev-sibling carries the comment, and TS's `export function foo` / `export class Foo` / `export
const foo = () => {}` nest the real declaration inside `export_statement` (and, for `const`, inside
`lexical_declaration` too) — `typescript_analyzer._doc_anchor(node)` walks up through
`lexical_declaration`/`export_statement` parents to find the right node before calling
`leading_doc_comment`, returning `(anchor, is_exported)` in one pass since the same walk answers both
questions (`typescript_analyzer._doc_fields(node, source)` wraps both calls for each of the three
call sites that need them). `module_symbol`/`class_symbol`/`function_symbol` each gained an optional
trailing `docstring` param (default `None`) so unrelated callers are unaffected. `Symbol` also gained
`is_exported: bool = False`, set at parse time by both analyzers that have an export concept: TS by
`_doc_anchor`'s `export_statement`-wrapper check, Go by `go_analyzer._is_exported(name)`
(`name[:1].isupper()`) at its `type_spec` and function/method symbol-construction sites — Python never
touches it. The Go module symbol never sets `is_exported`: `module.name` is the file's basename, not
the parsed package name, so capitalization there carries no export meaning; `_should_flag_gap` instead
always flags an undocumented Go module regardless of that field (see the gap-rule table below). This
replaced an earlier version where Go's export check lived in `wiki/generator.py` and re-derived it
from `Symbol.name` post-hoc; moving it into `go_analyzer.py` means `_should_flag_gap` reads
`symbol.is_exported` the same way for both languages, and any future caller (dependency digest, C1
diagram) gets the same field instead of reimplementing the capitalization rule.
Module-level ("global") parameters are a similar producer, not a new kind:
`python_analyzer._module_level_variables` walks only `root.children` directly (never descending into
a class/function body) and emits `SymbolKind.VARIABLE` symbols for simple, annotated, and
tuple-unpacked assignments — the same kind `go_analyzer.py` already emits for singleton detection,
just a second producer for it.

**File grouping.** `dependencies/digest.py`'s `_group_by_file` is now public `group_by_file`, and
its `_FileSymbols` dataclass gained a `variables: list[Symbol]` field. The wiki generator imports
`group_by_file` and `_FileSymbols` directly rather than re-deriving the module/classes/methods/
functions grouping a file page needs.

**Page tree** (`wiki/generator.py`, rendered by pure string builders in `wiki/writer.py`):

```text
.codechroma/wiki/
├── index.md                 # structure only -- top-level folder links, no README/prose
├── gaps.md                  # human-readable, grouped by file then kind
├── gaps.json                # machine-readable, same shape (path/qualified_name/kind/reason)
└── files/
    └── <folder>/[<nested-folder>/...]
        ├── index.md          # one per SYSTEM or PILLAR node, at every depth -- see below
        ├── sub_index_<N>.md  # only past settings.wiki_generator.folder_entry_cap (default 100)
        └── <path/as/in/repo>.md  # one per file with at least one parsed symbol
```

Every folder gets an `index.md`, not just top-level (`HierarchyLevel.SYSTEM`) ones — `write_folder_page`
(public since 028-wiki-freshness-sync, so `wiki/sync.py` can call it too) runs over every `SYSTEM`/
`PILLAR` node in the graph (`all_folders` in `generate_wiki`), placed at
`files/<node.source_path>/index.md`, so nesting mirrors the real directory tree exactly (this
replaced an earlier version of the feature that only indexed top-level folders and linked nested
ones as a bare, page-less directory — extended same-day on request once it shipped). A folder
page's subfolder entries link to the child's own `index.md` (`_folder_entries`), not a bare
directory. Only the *root* page (`index.md`) still lists top-level folders only — reaching a nested
folder means clicking through its parent's index, one level at a time, the same way a real directory
tree browses. A folder page's file entries only include files that have their own wiki page (i.e.
appear in `group_by_file`'s output) — an unparsed file (no analyzer, or a placeholder `COMPONENT`
node) is invisible to the wiki, matching FR-004's "one page per **parsed** source file" scope, not
"every file on disk." Pagination splits a folder's combined subfolder+file entry count only when it
exceeds the cap; every entry still gets a page, just spread across more files — never silently
truncated (Principle II).

**Any file with a parsed module symbol gets a full breakdown, not just Python.** `_has_breakdown`
(renamed from `_is_python_file` in 030-wiki-language-breakdown) checks only
`file_symbols.module is not None` — Go and TS/JS files now render their classes/functions the same
way Python does, since `GoAnalyzer`/`TypeScriptAnalyzer` populate `docstring` too (see Data model
above). `_has_module_variables` is a narrower, separate check (`language in ("python", "go")`) for
just the "Module Parameters" section — Go is the only non-Python language with its own module-level
`VARIABLE` symbols (singleton-detection pointer vars); TS/JS has none, so it stays empty for them
without needing a breakdown gate. A file with *no* parsed module symbol (an unsupported extension, or
a placeholder `COMPONENT` node) still gets `has_breakdown=False`'s "no breakdown for this language"
note.

**Gap collection is per-language, not Python-only** (`_gaps_for_file`, dispatching through
`_should_flag_gap(symbol, language, ts_gap_eligible)`):

| Language | Extension | Flags a gap when... |
|---|---|---|
| Python | `.py` | any module/class/method/function with `docstring is None` (unchanged) |
| Go | `.go` | `docstring is None` **and** (`symbol.kind == MODULE` **or** `symbol.is_exported`, set at parse time via `name[:1].isupper()`) — a package's own doc comment is always required, since a package isn't capitalization-gated the way a Go identifier is |
| TypeScript | `.ts`, `.tsx` | `docstring is None` **and** `symbol.is_exported` |
| TypeScript-as-JS | `.js`, `.jsx` | never — `TypeScriptAnalyzer` sets `language="typescript"` for all four extensions, so the gap rule branches on `Path(file_symbols.path).suffix`, not `Symbol.language`, to tell `.ts` from `.js` |
| any other parsed language | any | never (breakdown still shows, just no gap rule defined yet) |

This is a deliberate small `if`/`elif` in `wiki/generator.py`, not a per-language registry (plan.md's
Complexity Tracking: only 3 rule shapes exist, each 1-2 lines, and a registry would add an indirection
layer with no second caller). Every branch still emits `GapEntry(path, qualified_name, kind,
reason="no docstring")` — methods count as `kind="method"`, not `"function"`, so `gaps.json` readers
can tell a bare function from a class method. `WikiResult.documented_count`/`undocumented_count` are
computed alongside page writes, not as a second pass over the graph.

**Idempotent, full-replace output.** `generate_wiki` opens with `shutil.rmtree(output_dir,
ignore_errors=True)` — every run starts from empty, per the spec's Edge Cases ("previous output is
fully replaced, not merged"). `gaps.json` is written via `codechroma.io.write_json` (temp+rename), the
same atomic-write helper `dependency-digest.json` uses.

**Config.** `WikiGeneratorConfig.folder_entry_cap` (default 100) lives on `Settings` next to every
other subsystem's tunables (`config.py`) — no hardcoded pagination constant.

**Freshness sync (028-wiki-freshness-sync): `sync_wiki()` regenerates only what changed.**
`GraphEngine.sync_wiki(output_dir=None)` mirrors `generate_wiki()`'s guard/default-`output_dir`
shape exactly, then forwards to `wiki.sync.sync_wiki(engine, output_dir)`. 🔴 Same rule as
`generate_wiki()`: never called from `analyze()`/`reanalyze()` (contract test in
`tests/contract/test_graph_engine_api.py` patches `codechroma.engine.sync_wiki` and asserts it).

`wiki/hashtree.py`'s `HashNode` (`path`, `hash`, `children: dict[str, HashNode]`) is a Merkle tree
over the same SYSTEM/PILLAR/COMPONENT hierarchy `generate_wiki()` walks — `build_tree(graph,
repo_root)` hashes a file leaf as `sha1` of its real on-disk content (read fresh via `repo_root /
source_path`, not derived from the parsed `Symbol` data — a content change that doesn't touch any
docstring, e.g. a comment edit, must still register as changed, per spec's edge cases) and a
folder as `fingerprint.hash_lines(f"{name}:{child.hash}" ...)` over its direct children, reusing
the same hash primitive `docs/architecture/skill-artifact-merge.md` tracks as a fourth, deliberately
separate flat use. The tree persists as `.hashtree.json` inside the wiki's own `output_dir` (`io.
write_json`/`load_json_or_none`, same atomic-write convention `dependency-digest.json` uses) — a
dotfile, never mistaken for a readable page (FR-009), serialized via `dataclasses.asdict(tree)` (no
hand-rolled dict walk needed since `HashNode`'s only nested field is itself). `diff_tree(old, new)`
is the one-comparison freshness check: `old.hash == new.hash` at the root returns `[]` immediately
with no descent; a mismatch descends only into differing children, reporting a changed leaf's own
path or an added/removed node's whole path without descending further into it (an entirely new
folder is reported once, not per-file). 🔵 `build_tree()` itself still does one real disk read per
parsed file every call (needed for content-sensitivity); the "one comparison" the spec means is
`diff_tree`'s root check being the only per-file-content decision point, not a claim that
re-hashing itself is free. `build_tree()` takes an optional `children_map` so `sync_wiki()` can
build it once per call and hand it to both `build_tree()` and the partial-sync writer below, rather
than walking `graph.nodes` for parent/child edges twice.

`generator.py` also gained `write_root_page(graph, repo_root, output_dir)` (the root `index.md`
writer, extracted out of `generate_wiki()`'s own body) and promoted `write_text_file` (was private
`_write_text`) and `file_page_relative_path` (was private `_file_page_relative_path`) — these exist
specifically so `wiki/sync.py` reuses the exact same root-page, file-write, and page-path logic
`generate_wiki()` uses (the latter also lets `sync.py`'s `_delete_removed_page` find a removed
file's page without duplicating the naming rule), rather than a second copy that could drift.

`wiki/sync.py`'s `sync_wiki(engine, output_dir)` is a small facade: no prior `.hashtree.json` (first
run, or unreadable/corrupt — FR-006) delegates to `generate_wiki()` wholesale and persists a fresh
tree; a prior tree with `diff_tree()` returning `[]` returns immediately with no page or gap-report
write (US2's no-op fast path); otherwise it walks each changed path's ancestor folder chain (derived
from the path string's own `Path.parents`, not `HierarchyNode.parent_ids` — simpler and works
uniformly for a modified, added, *or removed* path, since a removed file has no surviving node to
walk from), rewrites only that file's page (`write_file_page`, promoted from `_write_file_page`) and
each surviving ancestor folder's index (`write_folder_page`, promoted from `_write_folder_page`,
using `children_by_parent`, promoted from `_children_by_parent`), always rewrites the root `index.md`
too via the shared `write_root_page` (its own content changes only when a top-level folder is
added/removed, so this is a same-bytes no-op write on every other sync), and recomputes
`gaps.md`/`gaps.json` from the in-memory `Graph` via the new `compute_gaps(files_by_path)` (a thin
loop over the existing private `_gaps_for_file`) even though gap reports aren't scoped to the
changed set — leaving them stale until the next full run was judged worse than a cheap,
always-in-memory recompute. A wholesale-added folder (reported as one path by `diff_tree`) is
expanded by `_write_folder_subtree`, which recurses through `children_by_parent` to write every
descendant file/folder page the same walk `generate_wiki()` already does. A removed path gets its
leftover wiki output deleted (`_delete_removed_page`: the file's `.md` page, or a removed folder's
whole subtree under `files/`), and its surviving ancestor folder's index is still rewritten, which
naturally drops the removed entry from that folder's listing. `build_tree()` treats a file it can't
read (deleted on disk since the last `reanalyze()`, so the in-memory `Graph` is stale relative to
disk) as hash `"missing"` rather than letting the `OSError` crash the whole sync — `sync_wiki()` is
meant to run right after a `reanalyze()`, but nothing enforces that ordering, so it must survive a
stale graph rather than raise. `GraphEngine.repo_root` is the single
place the "no prior `analyze()`" guard lives for this feature — it raises `RuntimeError` itself, so
neither `GraphEngine.sync_wiki()` nor `wiki.sync.sync_wiki()` need a second, separate check.

**New consumer (029-wiki-driven-diagrams): `GET /repos/{repo_id}/wiki-context`.**
`bridge/wiki_context.py::build_wiki_context()` reads back exactly what this module writes —
`index.md`, each requested path's `files/**/index.md`/`files/**/*.md` chain, and `gaps.json` — to
hand the `codechroma-draw-diagram` skill a bounded page bundle instead of a full raw-context dump.
The route calls `GraphEngine.sync_wiki()` inline before every read, so this is a second caller of
`sync_wiki()` beyond the freshness-sync flow described above, but writes nothing new and adds no new
persisted state. See `docs/architecture/diagram-skills.md`'s "Wiki-first fetch order".

Tests: `tests/unit/test_python_analyzer_docstrings.py` (docstring + module-variable extraction),
`tests/unit/test_go_analyzer_docstrings.py` and `tests/unit/test_typescript_analyzer_docstrings.py`
(`//`/JSDoc extraction, multi-line-comment joining, the `export`-wrapper anchor-resolution cases, and
`is_exported`), `tests/unit/test_wiki_writer.py` (pure render functions, incl. a non-Python
`has_breakdown=True` fixture proving Go/TS render identically to Python),
`tests/unit/test_wiki_generator.py` (hand-built `Graph` — page count, real docstrings, module parameters,
undocumented markers, gap shape, Go/TS/JS full-breakdown fixtures, the four per-language gap-rule
cases via `_gaps_for_file` directly, and a nested-`PILLAR`-folder fixture for the per-depth index
pages), `tests/integration/test_wiki_generation_end_to_end.py` (real `analyze()` → `generate_wiki()`
on `tests/fixtures/sample_repo` — whose `billing/reporter.go` and `web/UserCard.tsx` fixture files
exercise the real analyzers end-to-end, and whose `billing/models/` nested folder is exactly what
exercises the per-depth index pages here — plus the on-demand-only and pre-`analyze()` guard
assertions), `tests/unit/test_wiki_hashtree.py` (`HashNode`/`build_tree`/`diff_tree`/persistence,
incl. a file missing on disk hashing to `"missing"` instead of raising), `tests/unit/test_wiki_sync.py`
(the no-prior-state fallback), and `tests/integration/test_wiki_sync_end_to_end.py` (real
`analyze()`/`reanalyze()` → `sync_wiki()` across first sync, no-op sync, one file edited, one file
deleted, a whole folder deleted, a whole folder added, and a same-content rename — each asserting
which pages are rewritten, left untouched, or deleted from disk, not just `changed_paths`).
