---
name: codechroma-review-diagram
description: Review the repository's current change on the Impact diagram — explain per touched box what the change does (before/after). Use when the user (typically running you in the canvas terminal panel, or in the agent window over a PR/change) asks you to review, explain, or annotate the current changes on the Impact diagram — e.g. "review my diff", "explain these changes", "review the PR", "re-review the changes".
---

Write a **review of the current change** as a file the Code Atlas canvas reads and overlays onto the
Impact diagram. The bridge already computed which boxes the change touches — your job is to explain
each touched box: how it worked before, how it works now, and any box/relationship the change adds
or removes. This drives the `changes` overlay.

🔵 This skill used to also cover a `judgmental` axis (severity: judge which touched node is actually
a problem, and how severe). That axis was removed rather than kept half-wired (038 follow-up) —
there is no `"review"` overlay any more. It also used to run this same `explanatory` axis against
the C1 diagram instead of Impact; that moved here in the same follow-up, since Impact is already a
diff-only slice of the real graph (no pre-authored architecture diagram required) while C1's blocks
are hand-authored and addressed by path, not by real node id. Everything below covers the one
remaining (`explanatory`, `impact`) flow.

The canvas watches the file you write and re-renders live — you never call an API to publish it, you
just write it correctly. Write it more than once (a first pass over the biggest/worst nodes, then the
rest) so the user sees the review appearing while you keep working.

**Bridge base URL:** use `$CODECHROMA_BRIDGE_URL` if set; otherwise default to `http://localhost:8000`
as shown below.

## Step 1 — resolve the target workspace

**Write to the workspace the canvas is actually drawing**, not the one this agent run launched from.

```bash
curl -s "http://localhost:8000/agents"
# -> {"agents":[...], "active_workspace":"pr-29", ...}  — the id the canvas is drawing
```

Use that `active_workspace` value as `{repo_id}` in every `/repos/...` call below. Fall back to
`${CODECHROMA_WORKSPACE_ID:-default}` only if the query returns nothing usable. Address the **same**
id in every route call, so your review lands in the worktree the canvas draws.

## Step 2 — get the worklist, not a guess

**The bridge has already done the mapping. Fetch it and work from it.**

```bash
curl -s "http://localhost:8000/repos/${TARGET_WORKSPACE}/impact-changes"
```

Returns `fingerprint` (copy verbatim), `blocks[]` (every touched box: `block` — the box's own real
`node_id`, plus `name`, `path`, `status`, `files`, `change_count`), `unassigned[]`,
`changed_file_count`, `has_review`/`stale`. ⚠ **Never invent a `block` value** — copy it from
`blocks[].block`; an id the bridge doesn't recognize is silently dropped.

If there's nothing to review (no blocks touched — e.g. the Impact diagram hasn't been drawn yet, or
the diff touches nothing on it), say so and stop.

## Step 3 — read the actual change

For each node you're reviewing, read its diff — not the whole tree:

```bash
git diff -- <the node's file>          # tracked edits
git diff --stat                         # scale, at a glance
git status --porcelain                  # untracked/new files (no diff to read)
```

For an added node, read the file itself — there is no before side. For a removed one, read
`git show HEAD:<path>` to describe what was lost.

Describe the change in terms of **behavior and responsibility**, not line edits. "The builder now
creates one node per directory instead of clustering by references" is a review. "Changed 15 lines
in `_build`" is not.

## Step 4 — where the file goes

**Ask the bridge — do not guess from your working directory.**

```bash
curl -s "http://localhost:8000/repos/${TARGET_WORKSPACE}/impact-changes-path"
# -> {"repo_root":"...","impact_changes_path":"/abs/path/.codechroma/impact-changes.json","fingerprint":"…"}
```

Write the JSON to the returned `impact_changes_path`, **overwriting that file in place** — a re-run
edits the same file, never a second/parallel one. If the curl fails (bridge unreachable), edit an
already-written review in the active workspace rather than create one elsewhere: look for the file
at `<active workspace root>/.codechroma/impact-changes.json`, then `<cwd>/.codechroma/...`, then any
match under `$CODECHROMA_BRIDGE_REPO_PATH` if set. Tell the user which path you used either way. A
`FileWatcher` watches exactly that path — the wrong path means nothing appears.

## Schema

`fingerprint` is **required** (copied verbatim from the write-path fetch — without it the review is
treated as reviewing an unknown diff and thrown away), as is `summary` (one paragraph, the thing the
user reads first).

**`impact-changes.json`**:

```json
{
  "fingerprint": "copied verbatim from GET /impact-changes-path",
  "summary": "One paragraph: what this change set does to the architecture as a whole.",
  "blocks": [
    {
      "block": "server/internal/fit/rank.go::class::RankRequest",
      "before": "How this box worked before the change.",
      "after": "How it works now.",
      "explanation": "Why it changed, and what it means for the rest of the system."
    }
  ],
  "ghosts": [
    {
      "parent": "server/internal/fit/rank.go::class::RankRequest",
      "id": "reference-clustering",
      "name": "Reference clustering",
      "before": "The union-find pass that grouped directories by call edges.",
      "explanation": "Removed outright — grouping is filesystem layout now."
    }
  ],
  "relationships": [
    {"from": "server/api/handlers.go::function::Recommend", "to": "server/internal/fit/rank.go::class::RankRequest", "label": "Builds RankRequest from", "status": "added", "explanation": "…"}
  ]
}
```

- `blocks[].block` — a real graph `node_id`, copied verbatim from `GET /impact-changes`. One entry
  per box worth explaining.
- `blocks[].before`/`.after` — the heart of the review, one to three sentences each. Brand new:
  `before` is `""`. Being removed: the reverse.
- `blocks[].status` — omit unless the bridge got it wrong (it's inferred from git).
- `ghosts[]` — boxes the change **removes**; not in `impact.json` any more, so only you can name
  them. `parent` must be a real `node_id` from `GET /impact-changes` (the box that collapsed or
  otherwise still contains it); `id` is short kebab-case, unique under that parent. One per removed
  *concept*, not per deleted file.
- `relationships[]` — arrows the change adds/removes; both endpoints must exist on the diagram.
- Everything except `fingerprint` is optional. A partial review is fine.

## What to review, and what to skip

**Review** a node when the diff changes what it *does*: new behavior, a moved responsibility, a
changed contract, a removed pathway, a new dependency, a real risk. **Skip** it when the change is
mechanical: formatting, a rename with no behavior change, a comment, a version bump. Saying
"reformatted" in three sentences is worse than saying nothing.

Budget: **the whole review in one pass, biggest/worst nodes first.** 5-15 annotated entries for a
normal change set — let `summary` cover the rest of the shape.

## Procedure

1. Resolve the target workspace (Step 1).
2. Fetch the worklist + write-path/fingerprint (Steps 2 and 4).
3. If a current review already exists for this fingerprint, read it and **refine** it rather than
   starting over, preserving prose the user may have edited.
4. Read the diff of each node, most severe/biggest first.
5. Write the file — an early partial write is a feature; the canvas re-renders on every write.
6. Write the complete file again, to the same path.
7. **Self-check — never report success on a review the canvas will drop:**

   ```bash
   python3 .claude/skills/codechroma-review-diagram/scripts/check_review.py \
       --url http://localhost:8000 --repo "${TARGET_WORKSPACE}" --kind impact
   ```

   Fix and re-run until it prints `OK`.
8. Tell the user the absolute path you wrote, how many entries you reviewed, and that the view
   updates live.

To **clear** a review, write `{"fingerprint": ""}` to the same path, or delete the file.
