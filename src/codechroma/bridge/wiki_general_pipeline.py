"""run_pipeline(): 058's deterministic fan-out, replacing the old self-orchestrating `claude -p`.

Fan-out/wave-barriers/self-check used to be prose instructions one `claude -p` process gave itself
(`codechroma-wiki-general/SKILL.md`'s Phase A-E) -- on a large repo the model stopped following that
prose, spawned one giant sub-agent, and that sub-agent recursively re-invoked the same skill (see
docs/planning/058-wiki-general-deterministic-fanout's incident writeup). Here the fan-out itself is
plain Python (`asyncio.Semaphore`-bounded worker pool); the model only ever answers one bounded,
schema-constrained, zero-tool question per call (`wiki_general_worker.run_worker_job`), with no
chance to plan its own workflow or recurse into anything.

Nothing is written to `.codechroma/wiki-general/` until every worker call this run needs has
succeeded -- a failed job (after retries) or an unsupported adapter aborts with `state: "error"`
before a single page exists, matching the old skill's Phase-A-fails-first-writes-nothing behavior.
The one exception is a self-check failure *after* writing: those pages are left on disk for
debugging, the same way a hand-written bug in this pipeline would leave them -- only `manifest.json`
(the `SkillAgent` artifact) is snapshotted/restored automatically.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from codechroma.bridge.resources import resource_path
from codechroma.bridge.skill_agent import debug_write, open_debug_log
from codechroma.bridge.skill_output import flatten
from codechroma.bridge.wiki_context import WikiContextBundle, build_wiki_context
from codechroma.bridge.wiki_general_agent import compute_clustering, wiki_general_dir
from codechroma.bridge.wiki_general_job_context import build_job_context, first_sentence
from codechroma.bridge.wiki_general_naming import assign_ids
from codechroma.bridge.wiki_general_worker import (
    UnsupportedAdapterError,
    WorkerResult,
    require_minimal_context_support,
    run_worker_job,
)
from codechroma.config import settings
from codechroma.dependencies.clustering import aggregate_edges
from codechroma.dependencies.digest import _FileSymbols, group_by_file
from codechroma.io import load_module_from_path, write_json
from codechroma.prompts import render_prompt
from codechroma.wiki.writer import NO_DOCSTRING

if TYPE_CHECKING:
    from codechroma.bridge.skill_agent import OnOutput, SkillAgent
    from codechroma.bridge.workspaces import Workspace

logger = logging.getLogger("codechroma.bridge.wiki_general_pipeline")

_CHECK_SCRIPT = resource_path(
    "skills", "codechroma-wiki-general-update", "scripts", "check_wiki_general.py"
)

_C3_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "description": {"type": "string"},
    },
    "required": ["summary", "description"],
}

_C2_SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string"}, "description": {"type": "string"}},
    "required": ["summary", "description"],
}

_UNDETERMINED_SCHEMA = {
    "type": "object",
    "properties": {
        "assignments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "file": {"type": "string"},
                    "component_id": {"type": "string"},
                },
                "required": ["file", "component_id"],
            },
        }
    },
    "required": ["assignments"],
}

_NARRATIVE_SCHEMA = {
    "type": "object",
    "properties": {"narrative": {"type": "string"}},
    "required": ["narrative"],
}


def _load_check_module():
    """Loads the relocated check script by path -- same helper its own unit tests use."""
    return load_module_from_path("wiki_general_check", _CHECK_SCRIPT)


def _render_wiki_context(bundle: WikiContextBundle) -> str:
    if not bundle.has_wiki:
        return "(this repository has no plain wiki yet)"
    parts = [bundle.root] if bundle.root else []
    parts += [f"### {page.path} ({page.kind})\n{page.content}" for page in bundle.pages]
    if bundle.gaps:
        parts.append(f"(no wiki page exists for: {', '.join(sorted(bundle.gaps))})")
    return "\n\n".join(parts)


# Go _test.go, Python test_*.py/*_test.py, TS *.test.ts/*.spec.ts, Java Test*.java/*Test.java.
_TEST_STEM_PREFIXES = ("test_", "Test")
_TEST_STEM_SUFFIXES = ("_test", ".test", "_spec", ".spec", "Test")


def _is_test_file(path: str) -> bool:
    """Whether `path`'s own name looks like a test file, by common naming convention."""
    stem = Path(path).stem
    return stem.startswith(_TEST_STEM_PREFIXES) or stem.endswith(_TEST_STEM_SUFFIXES)


def _element(
    name: str, docstring: str | None, file: str, class_name: str | None, function_name: str | None
) -> dict:
    # Collapse a line-wrapped doc comment -- else a raw "\n" lands inside one bullet line.
    one_line = flatten(docstring, limit=len(docstring)) if docstring else ""
    return {
        "name": name,
        "description": first_sentence(one_line) if one_line else NO_DOCSTRING,
        "file": file,
        "class_name": class_name,
        "function_name": function_name,
    }


def _deterministic_elements(
    file_symbols_by_path: dict[str, _FileSymbols], files: list[str]
) -> list[dict]:
    """Every class/method/function `files` actually has, straight off the parsed graph."""
    elements: list[dict] = []
    for file in files:
        if _is_test_file(file):
            continue
        symbols = file_symbols_by_path.get(file)
        if symbols is None:
            continue
        for cls in symbols.classes:
            elements.append(
                _element(cls.name, cls.docstring, file, class_name=cls.name, function_name=None)
            )
            for method in symbols.methods_by_class_id.get(cls.id, []):
                elements.append(
                    _element(
                        method.name, method.docstring, file,
                        class_name=cls.name, function_name=method.name,
                    )
                )
        for func in symbols.functions:
            elements.append(
                _element(func.name, func.docstring, file, class_name=None, function_name=func.name)
            )
    return elements


def _neighbor_map(edges: dict[tuple[str, str], int]) -> dict[str, set[str]]:
    neighbors: dict[str, set[str]] = defaultdict(set)
    for from_id, to_id in edges:
        neighbors[from_id].add(to_id)
        neighbors[to_id].add(from_id)
    return neighbors


def _connections_lines(neighbors: set[str]) -> list[str]:
    if not neighbors:
        return []
    return ["", "## Connections", "", *(f"- Connects: `{n}`" for n in sorted(neighbors))]


def _render_c3_page(name: str, description: str, elements: list[dict], neighbors: set[str]) -> str:
    lines = [f"# {name}", "", description.strip(), "", "## Elements", ""]
    for element in elements:
        el_name = str(element.get("name") or "Element")
        el_desc = str(element.get("description") or "").strip().rstrip(".")
        lines.append(f"- **{el_name}** — {el_desc}.")
        file_path = element.get("file")
        if isinstance(file_path, str) and file_path:
            lines.append(f"  - File: `{file_path}`")
            class_name = element.get("class_name")
            if isinstance(class_name, str) and class_name:
                lines.append(f"  - Class: `{file_path}::{class_name}`")
            function_name = element.get("function_name")
            if isinstance(function_name, str) and function_name:
                lines.append(f"  - Function: `{file_path}::{function_name}`")
    lines += _connections_lines(neighbors)
    return "\n".join(lines) + "\n"


def _render_c2_page(
    name: str, description: str, components: list[tuple[str, str, str]], neighbors: set[str]
) -> str:
    lines = [f"# {name}", "", description.strip(), "", "## Components", ""]
    for component_id, component_name, summary in components:
        clean_summary = summary.strip().rstrip(".")
        lines.append(f"- [{component_name}](../c3/{component_id}.md) — {clean_summary}")
    lines += _connections_lines(neighbors)
    return "\n".join(lines) + "\n"


def _render_index(repo_name: str, narrative: str, containers: list[tuple[str, str, str]]) -> str:
    lines = [f"# {repo_name} — Architecture Map", "", narrative.strip(), "", "## Containers", ""]
    for container_id, name, summary in containers:
        lines.append(f"- [{name}](c2/{container_id}.md) — {summary.strip().rstrip('.')}")
    return "\n".join(lines) + "\n"


def _log_ts() -> str:
    return datetime.now(UTC).strftime("%H:%M:%S.%f")[:-3]


def _resolve_undetermined_assignments(
    undetermined: list[str],
    candidates_by_file: dict[str, list[str]],
    data: dict,
) -> dict[str, list[str]]:
    """file -> [chosen real component id] -- never unassigned; falls back to the first candidate."""
    chosen: dict[str, str] = {}
    for entry in data.get("assignments", []):
        if not isinstance(entry, dict):
            continue
        file, component_id = entry.get("file"), entry.get("component_id")
        if isinstance(file, str) and isinstance(component_id, str):
            chosen[file] = component_id
    extra: dict[str, list[str]] = defaultdict(list)
    for file in undetermined:
        candidates = candidates_by_file.get(file, [])
        pick = chosen.get(file)
        if pick not in candidates:
            pick = candidates[0] if candidates else None
        if pick is not None:
            extra[pick].append(file)
        else:
            logger.warning("wiki-general pipeline: %r has no candidate component, dropped", file)
    return extra


async def run_pipeline(
    agent: SkillAgent, workspace: Workspace | None, repo_id: str, on_output: OnOutput | None
) -> dict:
    """Opens the whole-run debug log, then hands off to the actual pipeline body."""
    if workspace is None:
        return {"state": "error", "error": "wiki-general pipeline requires a workspace"}

    pipeline_log = open_debug_log(agent.name, repo_id)
    started_at = datetime.now(UTC)
    debug_write(pipeline_log, f"{_log_ts()} PIPELINE START repo={repo_id}\n")
    try:
        return await _run_fanout(agent, workspace, repo_id, on_output, pipeline_log)
    except BaseException as exc:
        debug_write(pipeline_log, f"{_log_ts()} PIPELINE CRASHED {exc!r}\n")
        raise
    finally:
        dur = (datetime.now(UTC) - started_at).total_seconds()
        debug_write(pipeline_log, f"{_log_ts()} PIPELINE END dur={dur:.1f}s\n")
        if pipeline_log is not None:
            pipeline_log.close()


async def _run_fanout(
    agent: SkillAgent,
    workspace: Workspace,
    repo_id: str,
    on_output: OnOutput | None,
    pipeline_log,
) -> dict:
    """058's fan-out proper -- split out of run_pipeline so the debug log wraps every exit path."""

    async def emit(line: str) -> None:
        if on_output is not None:
            await on_output(repo_id, [line])

    adapter, binary, model, env_overrides = agent.resolve_cli()
    # An explicit --model re-triggers the CLI's rejection; omit it when ANTHROPIC_MODEL carries it.
    model = "" if "ANTHROPIC_MODEL" in env_overrides else model
    try:
        require_minimal_context_support(adapter, binary)
    except UnsupportedAdapterError as exc:
        return {"state": "error", "error": str(exc)}

    clustering = compute_clustering(workspace)
    component_groups = [(c["id"], c["files"]) for c in clustering["components"]]
    if not component_groups:
        return {"state": "error", "error": "clustering produced no components to document"}
    component_resolved = assign_ids(component_groups, top_level=False)

    component_container_internal = {
        component_id: container["id"]
        for container in clustering["containers"]
        for component_id in container["component_ids"]
    }
    container_files: dict[str, list[str]] = defaultdict(list)
    container_members: dict[str, list[str]] = defaultdict(list)
    for component in clustering["components"]:
        owner = component_container_internal.get(component["id"])
        if owner is not None:
            container_files[owner].extend(component["files"])
            container_members[owner].append(component["id"])
    container_groups = list(container_files.items())
    container_resolved = assign_ids(container_groups, top_level=True)

    component_real_id = {i: real for i, (real, _n) in component_resolved.items()}
    container_real_id = {i: real for i, (real, _n) in container_resolved.items()}

    component_edges = aggregate_edges(
        component_real_id,
        ((e["from"], e["to"], e["count"]) for e in clustering["component_edges"]),
    )
    container_edges = aggregate_edges(
        container_real_id,
        ((e["from"], e["to"], e["count"]) for e in clustering["container_edges"]),
    )
    component_neighbors = _neighbor_map(component_edges)
    container_neighbors = _neighbor_map(container_edges)

    wiki_dir = workspace.root / ".codechroma" / "wiki"
    concurrency = settings.wiki_general_pipeline.worker_concurrency
    semaphore = asyncio.Semaphore(concurrency)
    in_flight = 0
    completed_jobs = 0
    # Canvas progress bar's denominator (WikiGeneralNotice): undetermined + c3s + c2s + narrative.
    total_jobs = (
        (1 if clustering["undetermined_files"] else 0)
        + len(component_groups) + len(container_groups) + 1
    )

    async def worker(prompt: str, schema: dict, job_label: str) -> WorkerResult:
        # 🔴 Counted inside the semaphore, not before it -- else every queued job inflates this.
        nonlocal in_flight, completed_jobs
        async with semaphore:
            in_flight += 1
            debug_write(
                pipeline_log,
                f"{_log_ts()} START {job_label} (in_flight={in_flight}/{concurrency})\n",
            )
            job_started = datetime.now(UTC)
            try:
                result = await run_worker_job(
                    agent, repo_id, workspace.root, adapter, binary, model,
                    prompt, schema, env_overrides, job_label=job_label,
                )
            except BaseException:
                in_flight -= 1
                debug_write(
                    pipeline_log, f"{_log_ts()} CANCELLED {job_label} (in_flight={in_flight})\n"
                )
                raise
            in_flight -= 1
            completed_jobs += 1
            done_count = completed_jobs
            dur = (datetime.now(UTC) - job_started).total_seconds()
            status = "ok" if result.ok else f"FAILED: {result.error}"
            debug_write(
                pipeline_log, f"{_log_ts()} END   {job_label} dur={dur:.1f}s {status} "
                f"(in_flight={in_flight})\n"
            )
        # Outside the semaphore (WS send shouldn't hold up the next slot); canvas parses this line.
        await emit(f"→ {done_count}/{total_jobs} {job_label}")
        return result

    # --- resolve-undetermined: one batched call, 0+ files ---
    undetermined = clustering["undetermined_files"]
    extra_files: dict[str, list[str]] = {}
    if undetermined:
        await emit(f"⏺ resolve-undetermined ({len(undetermined)} files)")
        candidates_by_file = {
            f: [
                component_real_id[candidate["id"]]
                for candidate in clustering["undetermined_candidates"].get(f, [])
                if isinstance(candidate, dict) and candidate.get("id") in component_real_id
            ]
            for f in undetermined
        }
        context = build_job_context(wiki_dir, undetermined)
        prompt = render_prompt(
            "wiki_general_job_resolve_undetermined",
            files_with_candidates_json=json.dumps(
                [{"file": f, "candidates": candidates_by_file[f]} for f in undetermined], indent=2
            ),
            wiki_context=_render_wiki_context(context),
        )
        result = await worker(prompt, _UNDETERMINED_SCHEMA, "resolve-undetermined")
        if not result.ok:
            return {"state": "error", "error": f"resolve-undetermined failed: {result.error}"}
        extra_files = _resolve_undetermined_assignments(
            undetermined, candidates_by_file, result.data
        )
        await emit("✓ done")

    final_files = {
        real: sorted({*files, *extra_files.get(real, [])})
        for internal, files in component_groups
        for real in [component_real_id[internal]]
    }

    # --- write-c3: one call per component, concurrent ---
    await emit(f"⏺ write-c3 ({len(component_groups)} components)")
    # elements[] used to be LLM JSON -- now pure Python (see _deterministic_elements below).
    file_symbols_by_path = group_by_file(workspace.engine.snapshot())

    async def write_c3(internal_id: str) -> tuple[str, WorkerResult]:
        real_id, name = component_resolved[internal_id]
        container_internal = component_container_internal.get(internal_id)
        container_name = (
            container_resolved[container_internal][1] if container_internal is not None else ""
        )
        files = final_files[real_id]
        context = build_job_context(wiki_dir, files)
        prompt = render_prompt(
            "wiki_general_job_write_c3",
            display_name=name,
            component_id=real_id,
            container_name=container_name,
            files_csv=", ".join(files),
            wiki_context=_render_wiki_context(context),
        )
        result = await worker(prompt, _C3_SCHEMA, f"c3:{real_id}")
        if result.ok and result.data is not None:
            result.data["elements"] = _deterministic_elements(file_symbols_by_path, files)
        return real_id, result

    c3_outcomes = await asyncio.gather(*(write_c3(i) for i, _f in component_groups))
    failed = [(real_id, r.error) for real_id, r in c3_outcomes if not r.ok]
    if failed:
        return {"state": "error", "error": f"write-c3 failed for {failed[0][0]}: {failed[0][1]}"}
    component_pages = {real_id: r.data for real_id, r in c3_outcomes}
    await emit("✓ done")

    # --- write-c2: one call per container, concurrent, barrier on every C3 above ---
    await emit(f"⏺ write-c2 ({len(container_groups)} containers)")
    component_names = {real: name for real, name in component_resolved.values()}

    async def write_c2(internal_id: str) -> tuple[str, WorkerResult]:
        real_id, name = container_resolved[internal_id]
        members = [
            {"id": component_real_id[cid], "name": component_names.get(component_real_id[cid], "")}
            for cid in container_members.get(internal_id, [])
        ]
        prompt = render_prompt(
            "wiki_general_job_write_c2",
            display_name=name,
            container_id=real_id,
            components_json=json.dumps(members, indent=2),
        )
        return real_id, await worker(prompt, _C2_SCHEMA, f"c2:{real_id}")

    c2_outcomes = await asyncio.gather(*(write_c2(i) for i, _f in container_groups))
    failed = [(real_id, r.error) for real_id, r in c2_outcomes if not r.ok]
    if failed:
        return {"state": "error", "error": f"write-c2 failed for {failed[0][0]}: {failed[0][1]}"}
    container_pages = {real_id: r.data for real_id, r in c2_outcomes}
    await emit("✓ done")

    # --- system-narrative: one call, barrier on every C2 above ---
    await emit("⏺ system-narrative")
    containers_json = json.dumps(
        [
            {
                "id": real,
                "name": container_resolved[i][1],
                "summary": container_pages[real]["summary"],
            }
            for i, (real, _n) in container_resolved.items()
        ],
        indent=2,
    )
    narrative_result = await worker(
        render_prompt("wiki_general_job_system_narrative", containers_json=containers_json),
        _NARRATIVE_SCHEMA,
        "system-narrative",
    )
    if not narrative_result.ok:
        return {"state": "error", "error": f"system-narrative failed: {narrative_result.error}"}
    narrative = str(narrative_result.data.get("narrative", ""))
    await emit("✓ done")

    # --- deterministic write: pages + index.md + manifest.json -- no model call from here on ---
    directory = wiki_general_dir(workspace.root, repo_id)

    def write_pages_and_manifest() -> None:
        """Sync file-IO step, run off the event loop -- nothing here awaits anything."""
        manifest_components = []
        for internal_id, real_id in component_real_id.items():
            page = component_pages[real_id]
            (directory / "c3" / f"{real_id}.md").write_text(
                _render_c3_page(
                    page["summary"], page["description"], page.get("elements") or [],
                    component_neighbors.get(real_id, set()),
                ),
                encoding="utf-8",
            )
            owner_internal = component_container_internal.get(internal_id)
            owner_real = (
                container_real_id.get(owner_internal) if owner_internal is not None else None
            )
            manifest_components.append({
                "id": real_id,
                "name": component_resolved[internal_id][1],
                "container": owner_real,
                "path": f"c3/{real_id}.md",
                "files": final_files[real_id],
            })

        manifest_containers = []
        for internal_id, real_id in container_real_id.items():
            page = container_pages[real_id]
            members = [
                (component_real_id[cid], component_names.get(component_real_id[cid], ""),
                 component_pages[component_real_id[cid]]["summary"])
                for cid in container_members.get(internal_id, [])
            ]
            (directory / "c2" / f"{real_id}.md").write_text(
                _render_c2_page(
                    page["summary"], page["description"], members,
                    container_neighbors.get(real_id, set()),
                ),
                encoding="utf-8",
            )
            manifest_containers.append({
                "id": real_id,
                "name": container_resolved[internal_id][1],
                "path": f"c2/{real_id}.md",
                "files": container_files[internal_id],
            })

        index_containers = [
            (real, container_resolved[i][1], container_pages[real]["summary"])
            for i, (real, _n) in container_resolved.items()
        ]
        (directory / "index.md").write_text(
            _render_index(workspace.root.name, narrative, index_containers), encoding="utf-8"
        )

        manifest_edges = [
            {"from": a, "to": b, "count": count}
            for (a, b), count in sorted(component_edges.items())
        ] + [
            {"from": a, "to": b, "count": count}
            for (a, b), count in sorted(container_edges.items())
        ]
        manifest = {
            "generated_at": datetime.now(UTC).isoformat(),
            "containers": manifest_containers,
            "components": manifest_components,
            "edges": manifest_edges,
        }
        write_json(directory / "manifest.json", manifest)

    await asyncio.to_thread(write_pages_and_manifest)

    # --- self-check -- never report success on a run whose check didn't return OK ---
    await emit("⏺ self-check")
    check_module = _load_check_module()

    def fetch_gaps(paths: list[str]) -> set[str]:
        return set(build_wiki_context(wiki_dir, paths).gaps)

    exit_code, lines = check_module.run_checks(directory, fetch_gaps)
    for line in lines:
        await emit(line)
    if exit_code != 0:
        detail = lines[0] if lines else ""
        return {"state": "error", "error": f"self-check failed ({exit_code}): {detail}"}
    await emit("✓ done")

    return {"state": "idle", "error": None}
