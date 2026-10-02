---
name: codechroma-wiki-general-update
description: Patch this repository's semantic architecture map (.codechroma/wiki-general/) after a commit, touching only the pages affected by what changed -- never wipes or rebuilds the whole tree. Use when the user (typically running you in the canvas terminal panel, or as a background agent triggered by the canvas's "Update" button on the wiki-general staleness banner) asks you to update, refresh, or sync the "architecture map" / "wiki-general" after recent commits, as opposed to regenerating it from scratch.
---

Patch `.codechroma/wiki-general/` in place. This is the sibling of `codechroma-wiki-general` (the
full-rebuild skill) -- read `docs/architecture/wiki-general.md`'s "Staying current after a commit"
section if you want the full picture. The bridge has already done the hard part before this run
starts: it **recomputed the whole C2-join clustering** (same deterministic algorithm the full-rebuild
skill's Phase A uses, `dependencies/clustering.py`) and diffed it against the stored manifest
(data-model.md's Update state machine), applying every deletion for you already -- page removed,
manifest entry removed, parent link removed. You do not replan the tree and you never decide what
changed or where a file belongs -- you only write/refresh the pages you're told to.

🔴 This means the old "Update never touches c2/index.md/manifest structure" rule is **gone**. A real
merge/split/move can now change which containers/components exist, same as Generate -- the difference
from Generate is scope (only genuinely-changed pages get a model call) and speed, not what's off
limits.

You are given, already resolved into your own prompt for this run:
- **Newly created components** -- JSON `{id, name, container, files}` per entry. `id`/`name`/
  `container` are deterministic (no model call) -- do not rename or regroup, only write the page.
- **Rewritten components** -- JSON `{id, name unchanged, container, files}` per entry -- `files[]`
  changed since last run; refresh the page's element list against the new file set, don't rewrite it
  wholesale.
- **Newly created containers** -- JSON `{id, name, files}` per entry, same deterministic-naming rule.
- **Rewritten containers** -- JSON `{id, files}` per entry -- its component membership changed.

Any component/container id not listed in any of the four lists is genuinely `Unaffected` -- never
touch its page. Deletions already happened; there is nothing left for you to do about a deleted id.

This run has three phases:

- **A. Fan out** (subagents, concurrent) -- one subagent per created/rewritten component page, then
  (once those exist) one subagent per created/rewritten container page -- same "one subagent, one
  file, no shared file" shape as the full-rebuild skill's Phases B/C.
- **B. Self-check** (you) -- the same `check_wiki_general.py` the full-rebuild skill uses; it reads
  the whole tree from disk, so it still catches a bad patch even though this run only touched a few
  pages, including the new `CONNECTS-INVALID` check (`docs/architecture/wiki-general.md`'s self-check
  section) -- the same batched-fixup-then-fail flow applies here too.
- **C. Report progress** (you) -- same status-ping contract as every other headless run.

🔴 Never call `Write` on a `c3/*.md` or `c2/*.md` file yourself -- always spawn a subagent, exactly
like the full-rebuild skill's own rule.

## Phase A -- fan out the patch (concurrent)

**Base URL / workspace id / no-source-file-reads / plain-`curl`-only rules:** identical to
`codechroma-wiki-general/SKILL.md`'s Phase A -- read that skill's file if you haven't already; every
🔴 tripwire there (bridge contract, `wiki-context` failure handling, never `Read`/`find`/`cat`/`ls`
on the target repo's own source files) applies here unchanged. The one difference: you skip that
skill's clustering fetch and its naming/undetermined-bucket work -- you already have the exact
created/rewritten lists, ids, names, and file sets resolved.

One subagent per entry across the two component lists (created + rewritten), all launched **in a
single message** so they run concurrently (same wave-of-8 cap and "wait by ending your turn, not
polling" rule as the full-rebuild skill's Phase B, for the same reasons). Only after every component
subagent finishes, do the same for the two container lists (created + rewritten) -- a container page
links its components, so it must see their final state first, same ordering as the full-rebuild
skill's Phase B before C.

**A component subagent** (a `created` entry writes a fresh page; a `rewritten` entry patches an
existing one -- tell it which):

```
<Write a fresh file|Patch the existing file>: `.codechroma/wiki-general/c3/<component-id>.md`, the
page for the "<name>" component (container: "<container-id>") in this repo's AI-generated
architecture map. The id, name, and container are fixed -- do not invent or rename them. This
component's files are exactly: <files, comma-separated> -- do not add, drop, or guess a different
file list.

Ground yourself by calling `GET /repos/${CODECHROMA_WORKSPACE_ID:-default}/wiki-context?paths=<this
entry's files, comma-separated>` -- only these paths. Use that literal shell expression yourself.

If patching an existing page: read its current content first (it's your own prior output, not repo
source, so reading it directly is fine), then reconcile the "## Elements" bullets against the new
file list -- drop an element whose only file(s) are no longer in the list, add one for a new file
wiki-context reveals, and leave everything else byte-for-byte untouched. Don't rewrite the opening
description unless the file-list change genuinely invalidates it.

Format (same as the full-rebuild skill's Phase B, including the "## Connections" section -- given the
component's real neighbor ids from `component_edges[]`, translated to real ids, same rules: never a
component not given, omit the section if there are none):

# <name>

<One to three sentences: what this component is responsible for.>

## Elements

- **<Element name>** — <one-line description>.
  - File: `<repo-relative-path>`
  - Class: `<repo-relative-path>::<ClassName>`
  - Function: `<repo-relative-path>::<function_name>`

## Connections

- Connects: `<neighbor-component-id>`

Same reference rules as the full-rebuild skill: every File:/Class:/Function: value must be exactly
the repo-relative path you verified has a wiki page; Class/Function append ::<Name>. Never invent a
reference, never pad an element that doesn't need one.

Write only this one file.
```

**A container subagent** (same created-vs-rewritten distinction) mirrors the full-rebuild skill's
Phase C prompt exactly, plus the same "## Connections" section from `container_edges[]`.

If all four lists are empty, there is nothing to fan out -- skip straight to Phase B and report
success (a commit that changed nothing any page's grouping depends on is a valid, harmless outcome,
not an error).

## Phase B -- self-check -- never report success on a run that didn't print `OK`

```bash
python3 .claude/skills/codechroma-wiki-general-update/scripts/check_wiki_general.py \
  --repo "${CODECHROMA_WORKSPACE_ID:-default}"
```

The same script the deterministic full-rebuild pipeline runs by code after every generate (058), now
installed with this skill instead of the retired `codechroma-wiki-general` one. It reads the whole
tree from disk, so it validates your patch the same way it validates a full rebuild:
`HALLUCINATED` for a reference your patch introduced that doesn't resolve, `CONNECTS-INVALID` for a
`Connects:` line naming a non-edge (batched retry: ask the same subagent to fix its own page once,
then `--strip-connects` if it's still wrong), `DUPLICATE`/`DANGLING`/`EMPTY-CONTAINER` for anything a
bad edit could have broken structurally, `LINK-MISSING` advisory-only. Fix every non-advisory line
before reporting
success, following the same single-page-retry rule as the full-rebuild skill's own Phase E/"Failure
handling" section -- one retry subagent per flagged page, never a full restart.

## Phase C -- report progress

Same contract as every other headless run (`drawing-rules.md`'s "Bridge contract" /
`codechroma-wiki-general/SKILL.md`'s own "Report progress" section): before you start,
`POST /repos/{repo_id}/wiki-general/update` has already flipped the job to `generating` by the time
this run starts (the bridge does this, not you) -- once the self-check prints `OK` (or you've
confirmed there was nothing to patch), `POST /repos/{repo_id}/wiki-general/status` with
`{"state": "idle", "kind": "wiki-general-update"}`; if you abandon the run for any reason, `POST`
`{"state": "error", "detail": "<short reason>", "kind": "wiki-general-update"}` instead of leaving
the job stuck. 🔴 Always include `"kind": "wiki-general-update"` on this route -- it defaults to the
full-rebuild skill's own job otherwise, which would misreport whose run just finished. This only
matters if you're running this skill interactively in a terminal panel, not via the canvas's Update
button (which already reports through the right job for you).

There is no "gap" list anymore -- every real file lands in exactly one component or the small
undetermined bucket the full-rebuild skill's own escalation call handles, never in limbo. If the
bridge already deleted one or more components/containers this run (their pages and links are already
gone by the time you start), that's a normal, successful outcome -- nothing for you to report beyond
the usual `"idle"`.
