---
name: codechroma-workflow
description: Design and save a CodeChroma workflow (a steerable, step-by-step agent pipeline) from the user's description. Use when the user asks to create, draft or set up a new workflow -- e.g. "make a workflow that plans, implements and reviews a feature", "create a workflow for fixing a bug from an issue". You save it through the bridge's workflow API; the Workflows tab shows it at once.
---

You turn the user's description into one saved workflow. A workflow is a list of steps that run
one after another in their own git worktree. The user starts runs later from the Workflows tab.

Bridge: `{BRIDGE}` · workspace: `{WORKSPACE}` · repository root: `{REPO_ROOT}`

## Steps

1. Read the request. Look at the repository only when the request depends on it (its test or
   lint command, its layout). Keep this short.
2. List the saved workflows so you do not reuse an id or copy one that already exists:
   `curl -s {BRIDGE}/repos/{WORKSPACE}/workflows`
3. Ask the user only what you cannot decide well yourself (at most two short questions, in one
   message). Otherwise pick sensible defaults and say which ones you picked.
4. Write the definition (shape below) to a temp file and save it:
   `curl -s -w '\n%{http_code}\n' -X POST -H 'Content-Type: application/json' --data @<file> {BRIDGE}/repos/{WORKSPACE}/workflows`
   - `400` names the problem: fix it and post again.
   - `409` means the id is taken (pick another id) or the workspace is a read-only pull request.
   - To change a workflow you already saved in this session, `PUT` the full definition to
     `{BRIDGE}/repos/{WORKSPACE}/workflows/<id>`.
5. Reply with a short summary: the name, one line per step, and which input the run asks for.
   Tell the user they can edit it in the Workflows tab (All workflows → Edit) and run it from there.
   Do not start a run yourself.

## Shape

```json
{
  "id": "fix-bug",
  "name": "Fix a bug",
  "steps": [
    {
      "id": "s1", "slug": "investigate", "kind": "agent", "agent": "new",
      "prompt": "Find the cause of this bug: {{bug}}. Do not change code yet; report the cause and a fix plan.",
      "input": { "name": "bug", "label": "Which bug should be fixed?" }
    },
    { "id": "s2", "slug": "fix", "kind": "agent", "agent": "continue",
      "prompt": "Fix the bug as planned. Add a regression test and run the tests." },
    { "id": "s3", "slug": "review", "kind": "review", "prompt": "", "showDiff": true, "showSummary": true }
  ]
}
```

- `id` and every step `id`: letters, digits, `.`, `_`, `-`; start with a letter or digit; unique.
  Use a short kebab-case workflow id and `s1`, `s2`, ... for steps.
- `name`: short, in the user's language. `slug`: one or two lowercase words naming the step.
- `kind`: `agent` (an AI agent works; `prompt` is required) or `review` (the user checks the work,
  then approves or sends it back).
- `agent` (agent steps only):
  - `new`: a fresh agent that sees only its own prompt.
  - `handoff`: a fresh agent that also gets the previous step's result and diff stat. Good default
    after another step.
  - `continue`: resumes the nearest earlier agent step's session, so it keeps the whole
    conversation. Claude only, and both steps must use the same provider. Use it when a step
    carries on the same line of work (plan → implement). Avoid chains longer than 3 steps.
  - `continue:<stepId>`: continues a specific earlier agent step.
  - The first step is always `new`.
- `prompt`: clear, self-contained instructions. Say what to do, what not to do, and what to report
  at the end. It may start with a skill as `/skill-name ...`
  (`curl -s {BRIDGE}/repos/{WORKSPACE}/skills` lists them).
- `input` (agent steps only, optional): the one value the run asks for when it starts. `name` is a
  simple id used as `{{name}}` in that step's prompt; `label` is the question shown to the user.
  Each input name is unique in the workflow.
- `pauseBefore: true`: the run stops before this step until the user resumes it.
- Review steps: `showDiff` / `showSummary` choose what the user sees; `sendBackTo: "<agent step id>"`
  picks which earlier agent step reruns when the user sends the work back (default: the nearest one).
  A review step has no `agent`, `provider`, `model` or `input`.
- `provider` / `model`: leave them out (the workflow default) unless the user asks for one.

## Good workflows

- 2 to 6 steps. One clear job per step.
- Put a `review` step where a human should check the work: after code changes, before anything
  irreversible, and at the end.
- Ask for input once, on the first step that needs it, instead of guessing values like an issue,
  a branch or a feature description.
- Agent steps that change code end by running the repository's tests or checks and reporting the result.
