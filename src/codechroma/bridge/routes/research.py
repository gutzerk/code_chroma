"""Ask-a-question routes -- POST starts or answers inline, GET polls (see http-research.md)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi import APIRouter

from codechroma.bridge import research_agent
from codechroma.bridge.deps import Services, WritableWs, Ws
from codechroma.bridge.research_context import build_research_context
from codechroma.bridge.routes._skill_jobs import job_callbacks
from codechroma.bridge.routes.skill_runs import register_output_route
from codechroma.bridge.workspaces import Workspace
from codechroma.config import settings
from codechroma.io import load_json_or_none, write_json
from codechroma.prompts import render_prompt
from codechroma.research.models import ResearchAnswer
from codechroma.research.search import build_degraded_answer, find_hits

router = APIRouter()


def _read_answer(ws: Workspace, key: str) -> ResearchAnswer | None:
    data = load_json_or_none(research_agent.research_answer_path(ws.root, key))
    return ResearchAnswer.from_dict(data) if data is not None else None


def _write_answer(ws: Workspace, key: str, answer: ResearchAnswer) -> None:
    write_json(research_agent.research_answer_path(ws.root, key), answer.to_dict())


@router.post("/repos/{repo_id}/research")
async def ask_research(repo_id: str, ws: WritableWs, services: Services, q: str) -> dict:
    """Answers inline if degraded or cached; else starts (or attaches to) a background job."""
    key = research_agent.job_key(ws.id, q)
    cached = _read_answer(ws, key)
    if cached is not None:
        return {"job_key": key, "state": "done", "answer": cached.to_dict(), "error": None}

    hits, semantic = await asyncio.to_thread(
        find_hits, q, ws.engine.snapshot(), ws.root, settings.research.top_k
    )
    if not semantic:
        answer = build_degraded_answer(q, hits, datetime.now(UTC).isoformat())
        _write_answer(ws, key, answer)
        return {"job_key": key, "state": "done", "answer": answer.to_dict(), "error": None}

    on_status_change, on_output = job_callbacks("research", ws.emit, job_key=key)
    services.research_queries.remember(key, q)
    prompt = render_prompt("research_agent", query=q, job_key=key)
    agent = services.skill_agents["research"]
    state = await agent.start(key, ws.root, on_status_change, on_output, prompt)
    return {"job_key": key, "answer": None, **state}


@router.get("/repos/{repo_id}/research-search")
async def search_research(ws: Ws, q: str) -> dict:
    """Raw `find_hits()` search, no synthesis/subprocess/polling -- sibling of wiki-context."""
    hits, semantic = await asyncio.to_thread(
        find_hits, q, ws.engine.snapshot(), ws.root, settings.research.top_k
    )
    return {"query": q, "semantic": semantic, "hits": [hit.to_dict() for hit in hits]}


@router.get("/repos/{repo_id}/research/{job_key}")
def get_research_answer(ws: Ws, services: Services, job_key: str) -> dict:
    """Current state of a question's job, plus its answer once done."""
    state = services.skill_agents["research"].get_state(job_key)
    # Not gated on state == "done": a real SkillAgent run's success state is "idle", not "done".
    answer = _read_answer(ws, job_key)
    return {"job_key": job_key, "answer": answer.to_dict() if answer else None, **state}


register_output_route(
    router,
    agent="research",
    output_path="/repos/{repo_id}/research/{job_key}/output",
    key=lambda params, _services: params["job_key"],
)


@router.get("/repos/{repo_id}/research/{job_key}/context")
def get_research_context(ws: Ws, services: Services, job_key: str) -> dict:
    """The skill's only source of node ids -- search hits for the question this job_key names."""
    query = services.research_queries.get(job_key) or ""
    return build_research_context(ws.engine.snapshot(), ws.root, query)


@router.get("/repos/{repo_id}/research/{job_key}/path")
def get_research_path(ws: Ws, job_key: str) -> dict:
    """Absolute location the skill writes this question's answer to."""
    path = research_agent.research_answer_path(ws.root, job_key)
    return {"repo_root": str(ws.root), "answer_path": str(path)}
