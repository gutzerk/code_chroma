---
name: codechroma-grill
description: Ask the user decisions on the CodeChroma canvas instead of in chat text. Use whenever you need the user to choose between approaches, or when the user asks you to "grill me", interview them, or walk through design decisions one question at a time -- you ask through the `ask_user` MCP tool of the `codechroma` server.
---

When you need a decision from the user, ask it on the CodeChroma canvas with the `ask_user` MCP tool
(server `codechroma`, so the tool may appear as `mcp__codechroma__ask_user`). Never type the
question as chat text, and do not use `AskUserQuestion` when `ask_user` is available.

## How to ask

- One question per call, and wait for its answer before asking the next. A later question may
  depend on an earlier answer.
- Give 2-3 `options`, each with `id`, `title`, `description`, `pro`, `con`, `rank` and `why`.
  - `rank` orders your preference: exactly one option has `rank: 1`, the one you recommend.
  - `why` is one sentence on why it ranks where it does; `pro` and `con` are short and concrete.
- Keep `allow_custom` and `allow_skip` true unless a free-form answer makes no sense.
- For a multi-question session reuse one `session_id` and set `total` to the number of questions
  you expect, so the canvas can show progress.

## Using the result

- `{"answer": ..., "option_id": ..., "skipped": false}`: take `answer` as the user's decision (it
  is the chosen option's title, or the text they typed) and move on.
- `{"skipped": true}`: the user declined; pick your recommended option yourself, say so in one line,
  and continue.
- `{"pending": true, "question_id": "..."}`: the user has not answered yet. Call `ask_user_result`
  with that `question_id`, repeatedly if it is still pending, and do not proceed or re-ask the same
  question in the meantime.

If the `ask_user` tool is not available in this session, fall back to asking in chat.
