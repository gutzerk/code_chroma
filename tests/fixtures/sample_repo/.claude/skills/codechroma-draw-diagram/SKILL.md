---
name: codechroma-draw-diagram
description: Create, update, regenerate, deepen, or fix a Code Atlas diagram the canvas renders live — the C1 / system-context view, the design-patterns (GoF) view, the change-impact view (what this PR, diff or plan affects), or a custom / user-defined diagram type. Use when the user (typically running you in the canvas terminal panel or an agent window over a change) asks for any of those views by name or by artifact — e.g. "regenerate the C1 diagram", "add Stripe to the system context", "confirm the detected patterns", "the patterns view only shows a few blocks", "show me what this PR affects", "the impact view should also show the callers of X", "generate the data-flow diagram", "deepen the layering diagram", "the custom diagram is missing the new service". Also triggers on the artifact itself — c1.json, patterns.json, impact.json, custom/<type-id>.json. Also use to highlight or trace a specific process/flow on an already-drawn diagram without redrawing it — e.g. "show me how a request gets saved to the database", "highlight the auth check on this diagram". Also use to draw or update a **Feature-plan diagram** for a described future feature — its own Planned blocks (code that doesn't exist yet) alongside the minimal current-code context — e.g. "draw a plan for token auth", "show me what the checkout redesign will add", "add the planned rate limiter to this diagram". This one skill routes to the right diagram type and its reference; do not pick a diagram type before reading the router table.
---

Every diagram type here writes **one JSON file** that the Code Atlas canvas watches and re-renders
live — you never call a render API and the user never reloads. **Ask the bridge for the write path;
never guess it from your working directory.** Write the diagram fresh from what you find now — do
not fetch or read whatever is currently on disk/canvas first.
**Never report success on a run that didn't print `OK`** from the self-check.

## Router — pick by artifact, not by adjective

| type id | write to | draw this when the request is about… | read this reference | self-check |
|---|---|---|---|---|
| `c1` | `.codechroma/diagrams/c1/c1.json` (`GET /repos/{id}/c1-path`) | the **whole system** as one box plus the people and external systems around it, each decomposed into layers of sub-blocks down to real code — "regenerate the C1 diagram", "add Stripe to the system context", "the C1 view is missing our auth provider", "break the domain layer into sub-blocks" | `references/type-c1.md` | `check_diagram.py --kind c1` |
| `patterns` | `.codechroma/diagrams/patterns/patterns.json` (`GET /repos/{id}/patterns-path`) | the real **GoF/architectural pattern instances** in this repo (Strategy, Facade, Adapter, Registry, Repository, Singleton, Observer) plus the infra/external boxes that connect them — "regenerate the patterns diagram", "confirm the detected patterns", "the patterns view only shows a few blocks", "add the missing connections between patterns" | `references/type-patterns.md` | `check_diagram.py --kind patterns` |
| `impact` | `.codechroma/diagrams/impact/impact.json` (`GET /repos/{id}/impact-path`) | only the **slice a change or plan touches** — a git diff or a feature's spec files — plus the one-hop neighbours worth a box, background collapsed: "show me what this PR affects", "regenerate the impact diagram", "the impact view should also show the callers of X", "explain what each block does" | `references/type-impact.md` | `check_diagram.py --kind impact --source=diff` (or `--source=plan --feature=<dir>`) |
| `sequence` | `.codechroma/diagrams/sequence/sequence.json` (`GET /repos/{id}/sequence-path`) | the **ordered calls between systems/classes in one flow**, left-to-right participants top-to-bottom messages — "show me how a request is handled", "draw a sequence diagram of checkout", "what order do these get called in", "the flow of this trace" | `references/type-sequence.md` | `check_diagram.py --kind sequence` |
| `custom` | `.codechroma/diagrams/custom/<type-id>/<type-id>.json` (`GET /repos/{id}/custom/<type-id>-path`) | a **saved, user-authored diagram type** whose rules live in its own definition, not in this skill — "generate the data-flow diagram", "regenerate the ownership map", "deepen the layering diagram", or any run that was handed a `type_id` | `references/type-custom.md` | `check_diagram.py --kind custom --type <type-id>` |

> Pick exactly one row. Read that row's reference file in full before you write anything. Do not
> carry a rule from one row into another — the five schemas are different shapes on purpose.

> If the message that started this run already names a `references/type-*.md` file, that file wins
> over this table.

## Disambiguation

| Confusion | Pick this one |
|---|---|
| C1 vs Patterns | `c1` draws **the whole system decomposed into layers**; `patterns` draws **the GoF/architectural instances that exist inside it**. "How is this system built?" → C1. "Which patterns does it use?" → patterns. |
| C1 vs Impact | `c1` draws **everything**; `impact` draws **only the slice this change or plan touches**. Any mention of a PR, a diff, "what this affects", or a feature's spec directory → impact. |
| C1/Impact vs Sequence | C1/impact/patterns box up *which* systems exist and touch each other; `sequence` draws *how one flow unfolds in time*. "What depends on what" → impact/patterns; "in what order do the calls happen / how is this handled" → sequence. Any mention of a trace flow, a request's path, or "first X then Y" → sequence. |
| Custom vs everything | Pick `custom` when the request **names a saved type, or a `type_id` was passed**. When unsure, `GET /diagram-types` and see whether one matches; a saved type always wins over a built-in. |
| Nothing above fits — no matching row, no matching saved custom type, a genuine one-off request | Don't improvise from here. Jump straight to **Fallback** below. |

## Highlighting or expanding a process (not a new diagram)

The request is to *explain, show, or trace a process* on a diagram already on the canvas
("show me how a request gets saved to the database"), not to draw or regenerate one. This is not
one of the five `type id` rows above — it edits boxes already on the canvas instead of writing a
new `.codechroma/diagrams/<kind>/<kind>.json`. Read `references/highlight-process.md`.

## Drawing a Feature plan for work not yet done (not a new diagram either)

The request describes a **future feature** — the user's own words, or an arbitrary `.md` document
(a spec, a design doc, not necessarily `docs/planning/`) — and asks for a diagram of it: "draw a plan
for token auth", "show me what the checkout redesign will add", "add the planned rate limiter to this
diagram". This is not one of the five `type id` rows above either: you are authoring **Planned
blocks** (boxes for code that doesn't exist yet) into a diagram file dedicated to this one feature,
not into `c1`/`patterns`/`impact`/`custom`. Read `references/feature-plan-mode.md`.

## Fallback

None of the above → read `references/drawing-rules.md` and follow its **"Drawing a type this skill
does not know"** section.

## Shared rules

`references/drawing-rules.md` holds what every type obeys: the bridge contract (base URL, workspace
id, path resolution, fallback order), path honesty, the density budgets, the anti-pattern list, the
per-box and per-arrow `style` rule, the icon vocabulary, arrow-label style, and the self-check exit
tiers. Read it alongside your chosen `type-*.md`, not instead of it.
