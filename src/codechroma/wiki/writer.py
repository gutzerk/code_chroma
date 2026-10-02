"""Pure markdown-string builders for the wiki's pages -- no I/O, no graph traversal."""

from __future__ import annotations

from codechroma.wiki.models import GapEntry

NO_DOCSTRING = "*no docstring*"
NO_BREAKDOWN = "*no class/function breakdown for this language*"


def render_root_page(repo_name: str, folders: list[tuple[str, str]]) -> str:
    """Root index.md: repo name heading + a link to each top-level folder. Structure only."""
    lines = [f"# {repo_name}", "", "## Folders", ""]
    lines.extend(f"- [{name}]({link})" for name, link in folders)
    return "\n".join(lines) + "\n"


def render_folder_page(
    folder_path: str,
    subfolders: list[tuple[str, str]],
    files: list[tuple[str, str, str | None]],
) -> str:
    """One top-level folder's index.md: subfolder links, then file links with a docstring hint."""
    lines = [f"# {folder_path}/", ""]
    if subfolders:
        lines += ["## Subfolders", ""]
        lines += [f"- [{name}]({link})" for name, link in subfolders]
        lines.append("")
    lines += ["## Files", ""]
    lines += [f"- [{name}]({link}) — {hint or NO_DOCSTRING}" for name, link, hint in files]
    return "\n".join(lines) + "\n"


def render_folder_subindex(
    folder_path: str,
    part: int,
    total_parts: int,
    entries: list[tuple[str, str, str | None]],
) -> str:
    """One page of a paginated folder listing, used once a folder exceeds folder_entry_cap."""
    lines = [f"# {folder_path}/ (part {part} of {total_parts})", ""]
    lines += [f"- [{name}]({link}) — {hint or NO_DOCSTRING}" for name, link, hint in entries]
    return "\n".join(lines) + "\n"


def _render_methods(methods: list[tuple[str, str | None]]) -> list[str]:
    if not methods:
        return []
    lines = ["", "#### Methods", ""]
    lines += [f"- `{name}` — {docstring or NO_DOCSTRING}" for name, docstring in methods]
    return lines


def _render_class(
    name: str, docstring: str | None, methods: list[tuple[str, str | None]]
) -> list[str]:
    return [f"### {name}", "", docstring or NO_DOCSTRING, *_render_methods(methods)]


def render_file_page(
    file_path: str,
    module_docstring: str | None,
    variables: list[tuple[str, int]],
    classes: list[tuple[str, str | None, list[tuple[str, str | None]]]],
    functions: list[tuple[str, str | None]],
    has_breakdown: bool,
) -> str:
    """One parsed source file's page: module doc, module parameters, classes/methods, functions."""
    lines = [f"# {file_path}", "", module_docstring or NO_DOCSTRING]
    if not has_breakdown:
        lines += ["", NO_BREAKDOWN]
        return "\n".join(lines) + "\n"
    if variables:
        lines += ["", "## Module Parameters", ""]
        lines += [f"- `{name}` (line {line})" for name, line in variables]
    if classes:
        lines.append("")
        lines.append("## Classes")
        for name, docstring, methods in classes:
            lines.append("")
            lines.extend(_render_class(name, docstring, methods))
    if functions:
        lines += ["", "## Functions", ""]
        lines += [f"- `{name}` — {docstring or NO_DOCSTRING}" for name, docstring in functions]
    return "\n".join(lines) + "\n"


def render_gap_report(gaps: list[GapEntry]) -> str:
    """Human-readable gap report, one section per file, entries sorted by kind then name."""
    if not gaps:
        return "# Documentation Gaps\n\nNone -- everything has a docstring.\n"
    by_path: dict[str, list[GapEntry]] = {}
    for gap in gaps:
        by_path.setdefault(gap.path, []).append(gap)
    lines = ["# Documentation Gaps", ""]
    for path in sorted(by_path):
        lines.append(f"## {path}")
        lines.append("")
        for gap in sorted(by_path[path], key=lambda g: (g.kind, g.qualified_name)):
            lines.append(f"- {gap.kind} `{gap.qualified_name}` — {gap.reason}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
