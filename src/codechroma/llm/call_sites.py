"""The fixed, code-defined catalog of every AI call site the product makes -- not user-editable.

`simple` call sites make one direct-API completion and can be pointed at any provider transport;
`agentic` call sites run a headless CLI skill and can only ever resolve to a `kind="cli"` provider
(FR-008) -- there is no direct-API mode for a multi-turn agent run.
"""

from __future__ import annotations

from dataclasses import dataclass

Capability = str  # "simple" | "agentic"


@dataclass(frozen=True)
class CallSite:
    id: str
    label: str
    capability: Capability
    module: str
    description: str


CALL_SITES: dict[str, CallSite] = {
    site.id: site
    for site in (
        CallSite(
            "ai_summarizer",
            "AI summarizer",
            "simple",
            "summarize/ai_summarizer.py",
            "Runs once per node during GraphEngine.analyze(). Sends that node's code (bottom-up,"
            " using its children's summaries) to the model and stores the reply as the node's"
            " AISummary. No key configured -> writes a deterministic offline summary instead.",
        ),
        CallSite(
            "initial_diagram_bootstrap",
            "Initial diagram bootstrap",
            "simple",
            "context/patterns_generator.py",
            "A one-shot call that runs at most once per repo, before the first analyze() has ever"
            " written patterns.json: confirms/renames/rejects the free heuristic candidates"
            " patterns/detector.py already found. c1's bootstrap is now a deterministic table"
            " lookup (context/c1_template.py) and no longer shares this call site. Every later"
            " regenerate goes through c1_agent / patterns_agent (CLI runs) instead -- this setting"
            " never affects those.",
        ),
        CallSite(
            "c1_agent",
            "C1 diagram (regenerate)",
            "agentic",
            "bridge/content_generators.py (diagrams/registry.py's BUILTIN_TYPES[\"c1\"])",
            "A headless `claude -p` run (skill_agent.SkillAgent) of the codechroma-draw-diagram"
            " skill. It reads the repo's own files through the CLI's tools and rewrites c1.json."
            " Triggered by 'regenerate the C1 diagram' from the canvas.",
        ),
        CallSite(
            "patterns_agent",
            "Patterns diagram (regenerate)",
            "agentic",
            "bridge/content_generators.py (diagrams/registry.py's BUILTIN_TYPES[\"patterns\"])",
            "A headless CLI run of codechroma-draw-diagram (patterns type). It reads the actual"
            " classes behind each detected pattern and rewrites patterns.json, confirming or"
            " deepening what patterns_generator seeded.",
        ),
        CallSite(
            "impact-changes_review_agent",
            "Impact review skill",
            "agentic",
            "bridge/review.py",
            "A headless CLI run of codechroma-review-diagram (explanatory axis). It reads the"
            " working tree's current git diff and writes which Impact boxes it touches, for the"
            " Diff overlay.",
        ),
        CallSite(
            "impact_agent",
            "Impact diagram skill",
            "agentic",
            "bridge/content_generators.py (diagrams/registry.py's BUILTIN_TYPES[\"impact\"])",
            "A headless CLI run of codechroma-draw-diagram (impact type). It reads a diff/PR/plan,"
            " works out which graph nodes it reaches, and writes impact.json.",
        ),
        CallSite(
            "research_agent",
            "Research skill",
            "agentic",
            "bridge/research_agent.py",
            "A headless CLI run of codechroma-research, one per question (job-keyed). Searches the"
            " repo (embeddings + keyword) and writes a cited answer as that question's artifact.",
        ),
        CallSite(
            "epic_brief_agent",
            "Epic-brief skill",
            "agentic",
            "bridge/epic_brief_agent.py",
            "A headless CLI run of codechroma-epic-brief, one per epic (job-keyed). Reads that"
            " epic's tasks/requirements and writes its AI brief JSON: problem, scope, dependencies,"
            " risks, acceptance criteria.",
        ),
        CallSite(
            "wiki_general_agent",
            "Architecture map (generate)",
            "agentic",
            "bridge/wiki_general_agent.py",
            "A deterministic Python pipeline's pool of zero-tool worker calls (058). Full rebuild:"
            " reads the plain wiki and writes the whole C1/C2/C3 architecture-map page tree from"
            " scratch.",
        ),
        CallSite(
            "wiki_general_update_agent",
            "Architecture map (update)",
            "agentic",
            "bridge/wiki_general_agent.py",
            "A headless CLI run of codechroma-wiki-general-update. Patches only the pages a commit"
            " actually touched, instead of rebuilding the whole architecture-map tree.",
        ),
        CallSite(
            "parallel_agents",
            "Agent windows",
            "agentic",
            "terminal/agents.py",
            "A provider-routed interactive agent window (kind=\"agent\"): its CLI is resolved at"
            " launch from the `agents` group's assignment rather than the fixed `effective_cli`, so"
            " a provider added in the Providers tab (including a claude one pointed at a proxy) can"
            " power a canvas agent window. Unassigned falls back to `effective_cli`, exactly like"
            " every other agentic site -- FR-009.",
        ),
    )
}


@dataclass(frozen=True)
class CallSiteGroup:
    id: str
    label: str
    members: tuple[str, ...]


# Groups hidden by the "Model routing" tab; edited on "Agent windows" instead.
HIDDEN_GROUPS = frozenset({"agents"})

GROUPS: dict[str, CallSiteGroup] = {
    "diagrams": CallSiteGroup(
        "diagrams",
        "Diagrams",
        (
            "c1_agent",
            "impact-changes_review_agent",
            "patterns_agent",
            "impact_agent",
        ),
    ),
    "research": CallSiteGroup("research", "Research", ("research_agent",)),
    "planning": CallSiteGroup(
        "planning",
        "Planning",
        ("epic_brief_agent", "wiki_general_agent", "wiki_general_update_agent"),
    ),
    "agents": CallSiteGroup("agents", "Agent windows", ("parallel_agents",)),
}

_GROUP_BY_MEMBER: dict[str, str] = {
    member: group.id for group in GROUPS.values() for member in group.members
}


def group_of(call_site_id: str) -> str | None:
    """The owning group id for an agentic call site; None for a simple one or an unknown id."""
    return _GROUP_BY_MEMBER.get(call_site_id)
