# Feature-plan mode — drawing a plan for work not yet done

Read `drawing-rules.md` first — the bridge contract, density budgets, icons, the per-box `style`
rule and the self-check exit tiers live there and are not repeated here.

Use this when the request describes a **future feature** — in the user's own words, or an arbitrary
`.md` document (a spec, a design doc, not necessarily one under `docs/planning/`) — and asks for a
diagram of it: "draw a plan for token auth", "show me what the checkout redesign will add", "add the
planned rate limiter to this diagram". This is **not** one of the four `type id` rows in `SKILL.md`'s
router: you are authoring **Planned blocks** (boxes for code that doesn't exist yet, `meta.plan_kind`)
into a diagram file dedicated to this one feature, not into `c1`/`patterns`/`impact`/`custom`.

## 1. The Feature plan

Your brief is either the user's own words describing the feature, or the contents of a `.md` file
they named (read it directly — it doesn't have to live under `docs/planning/`). Quote the concrete
pieces back to yourself: what gets added, what existing code it touches, what it modifies or removes.
A vague one-liner ("add auth") is not enough to author real Planned blocks from — ask a clarifying
question rather than inventing scope.

## 2. Feature identity and slug

Every Feature plan is stored per feature, not per screen —
`.codechroma/diagrams/feature-plan/<slug>/<slug>.json`, one file per feature, independent of whatever
else is on the canvas.

- **This feature has a formal spec directory** (`docs/planning/<NNN>-<slug>/`) — use that directory's
  own `<slug>` (the part after `<NNN>-`), so this Feature-plan diagram and its spec share one name.
- **No formal spec directory** — derive a short, stable, kebab-case slug from the feature's own name
  or the first line of its description (e.g. "Token auth for the CLI" → `token-auth`), **no** numeric
  prefix — numbering belongs to `/speckit-specify`/`docs/planning`'s own process, don't invent a
  parallel one. Derive it the same way every time you're asked about the *same* feature again, so a
  later request naturally reproduces the same slug instead of minting a duplicate (step 3 below still
  double-checks this by resolving the slug before writing). If step 3 finds an artifact already at
  that slug whose content is clearly a **different** feature (name/description don't match), that's a
  genuine collision — append a short hash and use the new slug instead of overwriting someone else's
  plan.

## 3. Resolve the diagram target

**Always check for this feature's own artifact first, before deciding anything else:**

```bash
curl -s "http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/feature-plan/<slug>"
```

- **`has_diagram: true`** — this feature already has its own Feature-plan diagram. Deepen or correct
  it (SKILL.md's shared "deepen, don't restart" rule) — skip straight to step 4, the target is
  already decided.
- **`has_diagram: false`** — this feature has no diagram yet. What you do next depends on the canvas:

  ```bash
  curl -s "http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/canvas"
  ```

  - **Nothing is drawn on the canvas at all** (no elements, or only the seeded root) — draw a brand
    new diagram automatically. No need to ask; there is nothing to conflict with.
  - **The user's request already named a diagram to build on** ("add the plan to the current process
    diagram", "draw it into the C1 view") — use that diagram's own elements as your context source
    (step 4), same as if they'd answered the question below.
  - **The canvas has other diagrams, and the user didn't say which one to use as context** — stop and
    ask: use one of the existing diagrams as the basis for context, or draw this feature's diagram
    from scratch? Don't guess silently, and don't create a diagram no one asked for a shape of.

Whichever branch you took, the Planned blocks you author **always** go into this feature's own
`.codechroma/diagrams/feature-plan/<slug>/<slug>.json` — never into `c1.json`/`patterns.json`/
`custom/<id>.json`, even when one of those supplied the context you copied boxes from.

## 4. Minimal current context

Choose which existing code to show alongside the Planned blocks by your own judgment — the same way
`patterns`/`custom` read the wiki/explore the repo, **not** a deterministic graph slice like `impact`.
Enough context to see where the new pieces attach, no more:

- If step 3 pointed you at an existing on-canvas diagram, its elements (`node_id`/`path`/`name`) are
  your starting context — copy the relevant ones in verbatim rather than re-deriving them.
- Otherwise, follow `drawing-rules.md`'s Wiki-first fetch order (wiki-general, then the older wiki),
  then its "Docs-first" section, then `/structure` for real paths — same order every other type
  already uses.
- Never invent a path — copy `path`/`node_id` verbatim from the bridge, same rule as everywhere else.

## 5. Author Planned blocks

Planned blocks are ordinary entries in the one shared shape (`drawing-rules.md`'s "The one shared
diagram shape") — no new top-level schema field, just `meta.plan_kind` marking which nodes are part
of this feature's plan. Its mere presence is the marker; there is no separate boolean.

| `meta.plan_kind` | Meaning | `path`/`node_id` | Click behavior |
|---|---|---|---|
| `add` / `create` | Code that doesn't exist yet | **omit both** — its own box, not a badge on an existing ancestor | Opens the description popup (shows `meta.details` if you set it, else `description`) |
| `modify` | Existing code this plan will change | **real**, copied verbatim from `/structure` or your context source | Opens the real code, same as any ordinary node |
| `delete` | Existing code this plan will remove | **real**, copied verbatim | Opens the real code, same as any ordinary node |

- **Don't author `style` for the dashed border or the add/modify/delete color** — the canvas derives
  both from `meta.plan_kind` automatically. Authoring your own `style` on a Planned block only makes
  sense for an unrelated reason (e.g. flagging it critical on top of the normal look).
- `meta.details` is optional, richer text than `description`, shown in the popup for `add`/`create`
  only — same fallback rule as `plan.json`'s own `details` (used when set, `description` otherwise).
- Every node still needs a real `description` and, for context nodes, a real `path`/`node_id` — the
  usual anti-patterns (`drawing-rules.md`) still apply, including to Planned blocks.
- Set the top-level `"style"` (a catalog preset, usually `"boxes-arrows"`) same as any type authoring
  this shape directly — there's no external style source to inherit it from for this kind.

## 6. Where the file goes

```bash
curl -s "http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/feature-plan/<slug>-path"
# -> {"repo_root":"/abs/path/to/repo","feature_plan_path":"/abs/path/to/repo/.codechroma/diagrams/feature-plan/<slug>/<slug>.json"}
```

Write the JSON to the returned `feature_plan_path` (create
`.codechroma/diagrams/feature-plan/<slug>/` if missing). Fallback order if the bridge is unreachable:
see `drawing-rules.md`'s Bridge contract.

⚠ `drawing-rules.md`'s Bridge contract already excludes `feature-plan/<slug>` from the status-POST
section (only `c1` has a live status route) — nothing to send here, it never auto-generates.

## 7. Self-check — never report success on a run that didn't print `OK`

```bash
python3 .claude/skills/codechroma-draw-diagram/scripts/check_diagram.py --kind feature-plan --slug <slug>
```

Same flat-shape budgets as `custom` (60 nodes / 100 relations / 40-char names / 50-char edge labels)
and the same common codes (`drawing-rules.md`), with one exception:

An `add`/`create` node's missing `path` never triggers `BROKEN` — that's the whole point of the
marker (see step 5); don't work around a `BROKEN` you didn't expect by adding a fake path instead of
checking whether `meta.plan_kind` is actually set.

## 8. Deliver to the canvas

There is no "Draw" menu entry for a dynamic `feature-plan/<slug>` kind, so nothing on the canvas side
auto-triggers a redraw the way it does for `c1`/`patterns`/`custom`. Call the recipe run yourself
once the self-check prints `OK`:

```bash
curl -s -X POST "http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/recipes/feature-plan/<slug>/run"
```

This reconciles the `feature-plan/<slug>` canvas layer against the file you just wrote and broadcasts
the update to every connected canvas immediately — the diagram appears live, no reload needed. Check
the response's `"ok": true`; a rejected batch changes nothing.

**Re-running this same command later only touches this feature's own layer.** A Planned block
survives an unrelated diagram's regenerate untouched (each recipe only reconciles its own layer), and
re-running *this* feature's recipe after editing its file keeps everything you didn't remove from the
authored JSON — same ownership rule every other type's recipe already follows.
