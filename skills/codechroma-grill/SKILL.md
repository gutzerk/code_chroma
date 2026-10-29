---
name: codechroma-grill
description: Ask the user decisions on the CodeChroma canvas instead of in chat text. Use whenever the user must choose, decide or pick which approach to take, or asks you to "grill me", interview them, or walk through design decisions one question at a time -- you ask through the `ask_user` MCP tool of the `codechroma` server, then end your turn.
---

When you need a decision from the user, ask it on the CodeChroma canvas with the `ask_user` MCP tool
(server `codechroma`, so the tool may appear as `mcp__codechroma__ask_user`). Never type the
question as chat text, and do not use `AskUserQuestion` when `ask_user` is available.

## How to ask

- One question per call, and ask the next only after the answer arrives. A later question may
  depend on an earlier answer.
- Give 2-4 `options`, each with `id`, `title`, `description`, `pro`, `con`, `rank` and `why`.
  - `rank` orders your preference: exactly one option has `rank: 1`, the one you recommend.
  - `why` is one sentence on why it ranks where it does; `pro` and `con` are short and concrete.
- A call missing any of those fields, or without exactly one `rank: 1`, is rejected with the list of
  problems: fix them and call again; do not fall back to chat text.
- For a question that changes structure (boundaries, data flow, ownership, a new component), draw a
  diagram per option first with the `codechroma-decision-diagram` skill, then call `ask_user` with
  `kind: "diagram"` and each option's `diagram_ref`.
- Keep `allow_custom` and `allow_skip` true unless a free-form answer makes no sense.
- For a multi-question session reuse one `session_id` and set `total` to the number of questions
  you expect, so the canvas can show progress.

## After asking

`ask_user` returns at once with `{"asked": true, "question_id": "...", "next": "End your turn now..."}`.

- **Stop and end your turn right away.** Do not poll, do not wait, and never repeat the question in
  chat. CodeChroma types the answers into this terminal as your next message once the user has
  answered or skipped every question you have open, so you resume without the user typing anything.
- That message holds one part per question, in the order you asked. Each part starts with
  `[CodeChroma answer · Q1/3 · <question_id>]` and ends with `<question> → <outcome>`:
  - `→ <text>`: take it as the user's decision (the chosen option's title, or the text they typed)
    and move on.
  - `→ skipped by the user, decide yourself`: pick your recommended option, say so in one line, and
    continue.
  - `→ changed answer: <text>`: the user revised an earlier answer; adjust what you did since.
- A message starting `[CodeChroma request ...]` means the user wants a diagram per option on that
  question: draw one per option with `codechroma-decision-diagram`, then call `ask_user` again with
  the same `session_id` and question text and each option's `diagram_ref`.
- `ask_user_result` with a `question_id` reads an answer back; only use it if no message arrived.
  Once the answers are typed in, their cards and option diagrams are removed from the canvas, so
  the message is the only record: keep what you need from it.

Only if the `ask_user` tool is not available in this session, ask in chat instead.
