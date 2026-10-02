"""generate_wiki(): walks an already-parsed Graph and writes the markdown wiki tree to disk."""

from __future__ import annotations

import shutil
from pathlib import Path

from codechroma.config import settings
from codechroma.dependencies.digest import _FileSymbols, group_by_file
from codechroma.graph.models import (
    DIRECTORY_LEVELS,
    Graph,
    HierarchyLevel,
    HierarchyNode,
    Symbol,
    SymbolKind,
)
from codechroma.io import write_json
from codechroma.wiki.models import GapEntry, WikiResult
from codechroma.wiki.writer import (
    render_file_page,
    render_folder_page,
    render_folder_subindex,
    render_gap_report,
    render_root_page,
)

FilePages = dict[str, _FileSymbols]


def write_text_file(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def children_by_parent(nodes: dict[str, HierarchyNode]) -> dict[str, list[HierarchyNode]]:
    children: dict[str, list[HierarchyNode]] = {}
    for node in nodes.values():
        for parent_id in node.parent_ids:
            children.setdefault(parent_id, []).append(node)
    return children


def _first_line(text: str | None) -> str | None:
    return text.splitlines()[0] if text else None


def _folder_link_path(folder_path: str) -> str:
    return f"files/{folder_path}/index.md"


def file_page_relative_path(file_path: str) -> str:
    """`src/config.py` -> `src/config.md`, the page's path under `files/`."""
    return str(Path(file_path).with_suffix(".md"))


def _folder_entries(
    folder: HierarchyNode,
    children_by_parent: dict[str, list[HierarchyNode]],
    files_by_path: FilePages,
) -> tuple[list[tuple[str, str]], list[tuple[str, str, str | None]]]:
    """(subfolders, files) for one folder's direct children only, at any depth."""
    subfolders: list[tuple[str, str]] = []
    files: list[tuple[str, str, str | None]] = []
    for child in sorted(children_by_parent.get(folder.id, []), key=lambda n: n.name):
        if child.level == HierarchyLevel.COMPONENT:
            file_path = child.source_path or ""
            file_symbols = files_by_path.get(file_path)
            if file_symbols is None:
                continue
            link = Path(file_page_relative_path(file_path)).name
            hint = _first_line(file_symbols.module.docstring) if file_symbols.module else None
            files.append((Path(file_path).name, link, hint))
        else:
            subfolders.append((child.name, f"{child.name}/index.md"))
    return subfolders, files


def write_folder_page(
    folder: HierarchyNode,
    children_by_parent: dict[str, list[HierarchyNode]],
    files_by_path: FilePages,
    output_dir: Path,
) -> list[Path]:
    folder_path = folder.source_path or folder.name
    subfolders, files = _folder_entries(folder, children_by_parent, files_by_path)
    folder_dir = output_dir / "files" / folder_path
    cap = settings.wiki_generator.folder_entry_cap
    total_entries = len(subfolders) + len(files)
    if total_entries <= cap:
        text = render_folder_page(folder_path, subfolders, files)
        write_text_file(folder_dir / "index.md", text)
        return [folder_dir / "index.md"]

    combined: list[tuple[str, str, str | None]] = [(name, link, None) for name, link in subfolders]
    combined += files
    chunks = [combined[i : i + cap] for i in range(0, len(combined), cap)]
    pages = []
    sub_links = []
    for part, chunk in enumerate(chunks, start=1):
        name = f"sub_index_{part}.md"
        subindex_text = render_folder_subindex(folder_path, part, len(chunks), chunk)
        write_text_file(folder_dir / name, subindex_text)
        pages.append(folder_dir / name)
        sub_links.append((f"part {part}", name))
    index_text = render_folder_page(folder_path, sub_links, [])
    write_text_file(folder_dir / "index.md", index_text)
    pages.insert(0, folder_dir / "index.md")
    return pages


def _has_breakdown(file_symbols: _FileSymbols) -> bool:
    return file_symbols.module is not None


def _has_module_variables(file_symbols: _FileSymbols) -> bool:
    return file_symbols.module is not None and file_symbols.module.language in ("python", "go")


def _should_flag_gap(symbol: Symbol, language: str, ts_gap_eligible: bool) -> bool:
    """Per-language gap rule: Python always; Go package always, other Go/TS only when exported."""
    if symbol.docstring is not None:
        return False
    if language == "python":
        return True
    if language == "go":
        # A package isn't capitalization-gated like a Go identifier -- always flag it undocumented.
        return symbol.kind == SymbolKind.MODULE or symbol.is_exported
    if language == "typescript":
        return ts_gap_eligible and symbol.is_exported
    return False


def _gaps_for_file(file_symbols: _FileSymbols) -> list[GapEntry]:
    module = file_symbols.module
    if module is None:
        return []
    language = module.language
    path = file_symbols.path
    ts_gap_eligible = Path(path).suffix in (".ts", ".tsx")
    gaps: list[GapEntry] = []
    if _should_flag_gap(module, language, ts_gap_eligible):
        gaps.append(GapEntry(path=path, qualified_name=module.qualified_name, kind="module"))
    for cls in file_symbols.classes:
        if _should_flag_gap(cls, language, ts_gap_eligible):
            gaps.append(GapEntry(path=path, qualified_name=cls.qualified_name, kind="class"))
        for method in file_symbols.methods_by_class_id.get(cls.id, []):
            if _should_flag_gap(method, language, ts_gap_eligible):
                name = method.qualified_name
                gaps.append(GapEntry(path=path, qualified_name=name, kind="method"))
    for func in file_symbols.functions:
        if _should_flag_gap(func, language, ts_gap_eligible):
            gaps.append(GapEntry(path=path, qualified_name=func.qualified_name, kind="function"))
    return gaps


def write_file_page(file_symbols: _FileSymbols, output_dir: Path) -> Path:
    has_breakdown = _has_breakdown(file_symbols)
    variables = (
        sorted((v.name, v.start_line) for v in file_symbols.variables)
        if _has_module_variables(file_symbols)
        else []
    )
    classes = [
        (
            cls.name,
            cls.docstring,
            sorted(
                (m.name, m.docstring) for m in file_symbols.methods_by_class_id.get(cls.id, [])
            ),
        )
        for cls in sorted(file_symbols.classes, key=lambda s: s.name)
    ] if has_breakdown else []
    functions = (
        sorted((f.name, f.docstring) for f in file_symbols.functions) if has_breakdown else []
    )
    module_docstring = file_symbols.module.docstring if file_symbols.module else None
    text = render_file_page(
        file_symbols.path, module_docstring, variables, classes, functions, has_breakdown
    )
    page_path = output_dir / "files" / file_page_relative_path(file_symbols.path)
    write_text_file(page_path, text)
    return page_path


def compute_gaps(files_by_path: FilePages) -> list[GapEntry]:
    """Every undocumented symbol across every file, in path order -- shared full/partial sync."""
    gaps: list[GapEntry] = []
    for file_path in sorted(files_by_path):
        gaps.extend(_gaps_for_file(files_by_path[file_path]))
    return gaps


def write_gap_reports(gaps: list[GapEntry], output_dir: Path) -> tuple[Path, Path]:
    """Writes gaps.md + gaps.json for one gap list -- shared by full and partial sync."""
    gap_report_path = output_dir / "gaps.md"
    gap_json_path = output_dir / "gaps.json"
    write_text_file(gap_report_path, render_gap_report(gaps))
    write_json(
        gap_json_path,
        [
            {"path": g.path, "qualified_name": g.qualified_name, "kind": g.kind, "reason": g.reason}
            for g in gaps
        ],
    )
    return gap_report_path, gap_json_path


def write_root_page(graph: Graph, repo_root: Path, output_dir: Path) -> Path:
    """The wiki's index.md: top-level folder links only -- shared by full and partial sync."""
    top_level = sorted(
        (n for n in graph.nodes.values() if n.level == HierarchyLevel.SYSTEM),
        key=lambda n: n.name,
    )
    root_folders = [
        (folder.name, _folder_link_path(folder.source_path or folder.name)) for folder in top_level
    ]
    root_path = output_dir / "index.md"
    write_text_file(root_path, render_root_page(repo_root.resolve().name, root_folders))
    return root_path


def generate_wiki(
    graph: Graph,
    repo_root: Path,
    output_dir: Path,
    children_map: dict[str, list[HierarchyNode]] | None = None,
    files_by_path: FilePages | None = None,
) -> WikiResult:
    """Pure, synchronous: reads an in-memory Graph, writes markdown + gap report, returns result."""
    shutil.rmtree(output_dir, ignore_errors=True)
    if files_by_path is None:
        files_by_path = group_by_file(graph)
    if children_map is None:
        children_map = children_by_parent(graph.nodes)
    all_folders = sorted(
        (n for n in graph.nodes.values() if n.level in DIRECTORY_LEVELS),
        key=lambda n: n.source_path or n.name,
    )

    pages: list[Path] = [write_root_page(graph, repo_root, output_dir)]

    for folder in all_folders:
        pages.extend(write_folder_page(folder, children_map, files_by_path, output_dir))

    for file_path in sorted(files_by_path):
        pages.append(write_file_page(files_by_path[file_path], output_dir))

    gaps = compute_gaps(files_by_path)
    gap_report_path, gap_json_path = write_gap_reports(gaps, output_dir)

    return WikiResult(
        output_dir=output_dir,
        pages=pages,
        gap_report_path=gap_report_path,
        gap_json_path=gap_json_path,
        undocumented_count=len(gaps),
    )
