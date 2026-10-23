---
name: codechroma-wiki-general-update
description: Patch this repository's semantic architecture map (.codechroma/wiki-general/) after a commit, touching only the pages affected by what changed -- never wipes or rebuilds the whole tree. Use when the user (typically running you in the canvas terminal panel, or as a background agent triggered by the canvas's "Update" button on the wiki-general staleness banner) asks you to update, refresh, or sync the "architecture map" / "wiki-general" after recent commits, as opposed to regenerating it from scratch.
---

Patch `.codechroma/wiki-general/` in place. This file is self-contained: everything you need (page
formats, bridge calls, rules) is below. The bridge has already done the hard part before you write a
page: it **recomputed the whole C2-join clustering** (deterministic, no model) and diffed it against
the stored manifest, applying every deletion already -- page removed, manifest entry removed, parent
link removed. You do not replan the tree and you never decide what changed or where a file belongs;
you only write or refresh the pages you are told to.

## Bridge and workspace (read this first)

- **Base URL:** `$CODECHROMA_BRIDGE_URL`. **Workspace id:** `$CODECHROMA_WORKSPACE_ID`. The agent windows
  CodeChroma starts export both. Use the variable verbatim: the ids `agentN`, `main` and `default` may
  all answer, but only the exported one is yours. If either is empty, you are in a terminal CodeChroma
  did not launch: ask the user for both rather than guessing a port, and never fall back silently to
  `localhost:8000`/`default`.
- All calls are plain `curl` (or the check script); do not `Read`/`find`/`cat`/`ls` the target repo's
  own source files -- ground every page in `wiki-context` below.

## Step 0 -- get the work list

The canvas "Update" button (or the bridge's own run) puts four lists in your prompt: **created
components**, **rewritten components**, **created containers**, **rewritten containers**
(`{id, name, container, files}` entries). Use them as given.

If you were started from a terminal and your prompt has **no lists**, get them from the bridge -- do
not work them out yourself:

```bash
# Read-only preview (changes nothing):
curl -s "$CODECHROMA_BRIDGE_URL/repos/$CODECHROMA_WORKSPACE_ID/wiki-general/update-plan"
# Start the run: applies the deletions, flips the job to "generating", returns {state, error, delta}:
curl -s -X POST "$CODECHROMA_BRIDGE_URL/repos/$CODECHROMA_WORKSPACE_ID/wiki-general/update-plan"
```

`delta.components` and `delta.containers` each hold `created`, `rewritten`, `deleted`, `unaffected`.
Call the POST exactly once per run (a second call sees the already-updated manifest and returns an
empty plan). Do **not** call `POST .../wiki-general/update` from a terminal: that starts a second,
headless agent that duplicates your work.

Any id not listed in `created`/`rewritten` is `unaffected` -- never touch its page. If all four lists
are empty there is nothing to write: go to Step 3 and report success (a commit that changed nothing
the grouping depends on is a valid outcome).

## Step 1 -- write the component pages (concurrent subagents)

🔴 Never `Write` a `c3/*.md` or `c2/*.md` file yourself -- spawn one subagent per page (all component
subagents in a single message, at most 8 per wave; wait by ending your turn, do not poll). Only after
every component subagent finished, do the container pages (Step 2): a container links its
components, so it must see their final state.

**Component subagent** (`created`: write a fresh page; `rewritten`: patch the existing one):

```
<Write a fresh file|Patch the existing file>: `.codechroma/wiki-general/c3/<component-id>.md`, the page
for the "<name>" component (container: "<container-id>"). The id, name and container are fixed -- do
not invent or rename them. This component's files are exactly: <files, comma-separated> -- do not add,
drop, or guess a different file list.

Ground yourself by fetching the wiki pages for these files, ONE FILE PER REQUEST:
  curl -s "$CODECHROMA_BRIDGE_URL/repos/$CODECHROMA_WORKSPACE_ID/wiki-context?paths=<one file>"
(A multi-path request is cut off at about 16 KB. If the response has "truncated": true, the paths in
"omitted" (see "warning") have NO page in "pages" even though "gaps" is empty -- ask for each omitted
path again on its own. Never write about a file whose page you did not receive.)
Files with a "gaps" entry have no wiki page (non-code files such as workflows or scripts, or files
the wiki skipped): describe them only from the file list, never invent symbols for them.

If patching: read the current page first (it is your own earlier output, so reading it is fine),
reconcile the "## Elements" bullets against the new file list -- drop an element whose only files
are gone, add one for a new file the wiki reveals -- and leave everything else byte-for-byte
untouched. Do not rewrite the opening description unless the file-list change invalidates it.

Format:

  # <name>

  <One to three sentences: what this component is responsible for.>

  ## Elements

  - **<Element name>** — <one-line description>.
    - File: `<repo-relative-path>`
    - Class: `<repo-relative-path>::<ClassName>`
    - Function: `<repo-relative-path>::<function_name>`

  ## Connections

  - Connects: `<neighbor-component-id>`

Every File:/Class:/Function: value must be a repo-relative path you received a wiki page for;
Class/Function append ::<Name>. Never invent a reference and never pad an element that needs none.
"## Connections" lists only real neighbor ids given to you from the edges (never a component you were
not given); omit the section when there are none.

Write only this one file.
```

## Step 2 -- write the container pages and the root links

**Container subagent** (`created`: fresh page; `rewritten`: patch). Give it the container id, name,
and its component ids and names (all components in `manifest.json` whose `container` is this id, not
only the changed ones). Page `.codechroma/wiki-general/c2/<container-id>.md`:

```
# <Container name>

<One to two sentences: what this container is and its role in the system, from its components.>

## Components

- [<Component name>](../c3/<component-id>.md) — <one short sentence, no trailing period>

## Connections

- Connects: `<neighbor-container-id>`
```

- The `## Components` list must contain **every** component of the container -- not just the ones that
  changed -- so a link that was already missing before this run is repaired now (the self-check's
  `LINK-MISSING` is advisory, but fix every one you see). `## Connections` follows the same rule as
  for components (only given neighbors, omit when none).
- For a **created** container, also add one line to `.codechroma/wiki-general/index.md` (you may edit
  this one file yourself): `- [<Container name>](c2/<container-id>.md) — <short sentence>` under
  "## Containers".
- Page names are display names: two components can share a display name, but ids are unique. Never
  rename an id to fix a clash.

## Step 3 -- self-check, then report (never report success unless the check printed `OK`)

```bash
python3 .claude/skills/codechroma-wiki-general-update/scripts/check_wiki_general.py
```

The script reads `$CODECHROMA_BRIDGE_URL` and `$CODECHROMA_WORKSPACE_ID` itself (override with
`--url`/`--repo`; it falls back to `localhost:8000`/`default` only when they are unset). It reads the
whole tree from disk, so it validates your patch the same way it validates a full rebuild:
`HALLUCINATED` for a reference that matches no wiki page, `CONNECTS-INVALID` for a `Connects:` line
naming a non-edge (ask the same subagent to fix its own page once, then
`check_wiki_general.py --strip-connects <page> <target-id>` if it is still wrong),
`DUPLICATE`/`DANGLING`/`EMPTY-CONTAINER` for structural breakage, `LINK-MISSING` advisory. Fix every
non-advisory line with **one retry subagent per flagged page** -- never a full restart, and never
report success past a `FAILED`.

Then report through the bridge. The job is already `generating` (the bridge or Step 0 set it):

```bash
curl -s -X POST "$CODECHROMA_BRIDGE_URL/repos/$CODECHROMA_WORKSPACE_ID/wiki-general/status" \
  -H 'content-type: application/json' \
  -d '{"state": "idle", "kind": "wiki-general-update"}'
```

If you abandon the run, POST `{"state": "error", "detail": "<short reason>", "kind":
"wiki-general-update"}` instead of leaving the job stuck. 🔴 Always include `"kind":
"wiki-general-update"`: it defaults to the full-rebuild job otherwise and would misreport whose run
finished. (When the canvas's Update button started you, the bridge reports for you, and it verifies
that the pages in your lists exist before it marks the job idle.)

There is no "gap" list: every real file lands in exactly one component or the small undetermined
bucket. If the bridge already deleted components or containers this run, that is a normal, successful
outcome -- report the usual `"idle"`.

The repo's `skills/` directory is the only source of this skill; `.claude/skills/` copies are
regenerated by the bridge, so never edit them.
