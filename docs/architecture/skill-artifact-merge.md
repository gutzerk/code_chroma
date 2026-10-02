# Skill-artifact merge: the "fresh source + authored overlay" idiom

> 🔵 This is a **dependency-free doc task**, split out of the composite-runner unification (planning
> `012-unify-composite-skill-runners`). It documents an idiom the merge sites already share; it is not
> code, and nothing here changes behavior.

## What this idiom is

A `SkillAgent` run writes an authored artifact (`.codechroma/c1.json`, `patterns.json`, a brief) that
captures things a deterministic analyze can't: a human's or model's confirmations, prose
descriptions, infra/external boxes. But the repo's *structure* moves on. Rather than trust the
artifact verbatim — which would go stale — each resolver recomputes the fresh, structural half from
the graph/markdown and splices the authored half on top at **read time**:

```text
fresh_source (always recomputed)  ──┐
                                    ├──▶ resolve() response
authored_overlay (from artifact) ───┘
        (id-keyed splice)
```

The authoring skill never overwrites the structural half back onto disk with its stale copy —
it writes only its own fields — so the merge stays idempotent and the artifact's authored field
wins while the structural field is always current.

## The three merge sites

| Site | Fresh source | Authored overlay | Splice key | Staleness signal |
|---|---|---|---|---|
| `c1_resolver.py` (`resolve_c1`) | graph's current nesting | authored C1 block tree | block `node_id` | — (C1 has no fingerprint) |
| `patterns_resolver.py` (`resolve_patterns`, `_merge`) | `graph.pattern_candidates` (recomputed every analyze) | `patterns.json`: confirmed/name/description/participant descriptions + authored `nodes`/`relations` | candidate `id` | `patterns.json.fingerprint` vs `fingerprint_for(candidates)` |
| `epic_brief_resolver.py` (`resolve_brief`), + `overlays.py` (`resolve_impact_changes`) | `tasks.md` task `text`/`parallel` (from `build_brief_bundle`), or the git diff's block statuses | the brief's task rows, or the review's badges | `(stage, task_id)`, or block `node_id` | reviewed `overlays.fingerprint` vs `fingerprint_for(diff statuses)` |

The `overlays.resolve_impact_changes` and `patterns_resolver.resolve_patterns` halves both return a
**fingerprint staleness** pair to the canvas:

```text
"fingerprint":          <current>,   # from fresh source, so a real change flips it
"reviewed_fingerprint": <authored>,  # what the skill last declared it reviewed
"stale":                reviewed != current   (False when nothing was authored yet)
```

That is how the UI shows "your review is stale, the repo moved" without re-running the agent.

## Why this stays per-site (no shared `_merge` helper unlocked)

The three splices look similar but differ in structure:

- **C1/change-review** walk a nested/blocks tree keyed by `node_id`.
- **Patterns** merge one flat list of instances keyed by candidate `id`, plus a pass-through of
  authored `nodes`/`relations` no heuristic can derive.
- **Epic brief** key their splice on `(stage, task_id)` and refresh only `text`/`parallel`, leaving
  every other brief field authored-only.

A shared `_merge` would force the awkward-wrapper the docs elsewhere warn against, so each site
keeps its own thin merge. This file exists so a fifth site replicates the *shape* — recompute fresh,
splice authored by id, expose a fingerprint staleness pair — not a copy of someone else's loop.

## Not a fourth site: `GET /repos/{id}/wiki-context` (029-wiki-driven-diagrams)

`bridge/wiki_context.py::build_wiki_context()` is a read-only context-builder, the same shape as
`patterns_context.py`/`impact_context.py`/`context/digest.py` — it hands a diagram-authoring skill
material to *write* an artifact from, before any resolver runs. It has no authored overlay, no
splice key, no fingerprint of its own, and nothing to merge: it's context-gathering at *authoring*
time, not artifact-resolving at *read* time. Don't confuse the two when a wiki-related change looks
like it belongs in this file — it almost certainly belongs in `docs/architecture/diagram-skills.md`
or `wiki-generator.md` instead.

## The optional `fingerprint()` extraction

The three merge sites do **not** currently share a `fingerprint_for` implementation: patterns uses
`patterns.serialize.fingerprint_for(candidates)`, change review uses
`overlays.fingerprint_for(diff statuses)` (over `codechroma.fingerprint.hash_lines`). Only if the
three converge on one exact computation should a shared helper be extracted — **deliberately optional**,
skip it if they keep diverging.
