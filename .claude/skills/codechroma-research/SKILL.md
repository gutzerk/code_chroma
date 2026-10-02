---
name: codechroma-research
description: Answer a natural-language question about this repository's code with a short, cited answer that jumps to real locations. Use when the user (typically running you in the canvas terminal panel, or via the research panel) asks a question about where something lives or how it works — e.g. "where is JWT validated", "what does the billing module do" — and expects a synthesized answer with citations, not a raw grep.
---

Answer one specific question about this repository, citing only real, existing locations the
bridge's own search already found for you. You are the narration step, not the search step — the
deterministic half already ran before you were invoked.

**The prompt that invoked you already carries two facts: the question (`query`) and this run's
`job_key`.** Use them exactly as given — never rephrase the question before answering it, and never
guess a `job_key`.

**Bridge base URL:** use `$CODECHROMA_BRIDGE_URL` if set (the desktop app's terminal panel exports the
real dynamic port there); otherwise default to `http://localhost:8000` as shown below.

**Workspace id:** every `/repos/{repo_id}/...` path below uses `${CODECHROMA_WORKSPACE_ID:-default}`,
never a hardcoded `default` — the bridge sets `CODECHROMA_WORKSPACE_ID` on this run (e.g. `pr-29`) and
leaves it unset only for the main workspace, where `:-default` resolves to `default`. A hardcoded
`default` would resolve `answer_path` into the main checkout even when this run is scoped elsewhere.

## Fetch your only source of node ids

```bash
curl -s "http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/research/{job_key}/context"
```

(substitute the real `job_key` from the prompt). Returns:

```json
{
  "query": "where is JWT validated",
  "semantic": true,
  "hits": [
    { "node_id": "function::src/auth/jwt.py::validate_jwt", "score": 0.83,
      "summary_text": "Validates a JWT's signature and expiry before...", "path": "src/auth/jwt.py",
      "symbol": "validate_jwt" }
  ]
}
```

⚠ **This list is the entire universe of things you may cite.** `hits` may be short or even empty
(no relevant match) — that is a real answer, not a failure on your part. Never cite a `node_id` that
isn't in this list, and never invent one from your own general knowledge of what a JWT validator
"should" look like. If `hits` is empty, say plainly that no relevant match was found; don't fabricate
an answer to fill the silence.

`semantic: true` means the hits came from real embedding similarity over the repo's AI-written
summaries — trust their ranking. `semantic: false` means they came from plain keyword overlap
(no embeddings provider configured) — still real, but weaker signal; weight your confidence
accordingly in how you phrase the answer, without saying anything false about *why* it's weaker.

## Where to write

```bash
curl -s "http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/research/{job_key}/path"
# -> {"repo_root": "/abs/path/to/repo", "answer_path": "/abs/path/to/repo/.codechroma/research/answers/<hash>.json"}
```

Write the JSON to `answer_path` (create parent directories if missing).

## Schema

```json
{
  "query": "where is JWT validated",
  "answer": "JWT validation happens in `validate_jwt` [1], which checks the signature and expiry before the request handler [2] accepts the token.",
  "citations": [
    { "node_id": "function::src/auth/jwt.py::validate_jwt", "path": "src/auth/jwt.py", "symbol": "validate_jwt" },
    { "node_id": "function::src/api/routes.py::login", "path": "src/api/routes.py", "symbol": "login" }
  ],
  "degraded": false,
  "generated_at": "2026-01-01T00:00:00Z"
}
```

Rules:
- `answer` is short prose (a few sentences, markdown allowed) that may reference citations inline as
  `[1]`, `[2]`, ... in the order they appear in `citations`.
- Every `citations[].node_id` **must** be copied verbatim from a `hits[].node_id` the context call
  gave you — never edited, never invented, never from a different question's hits.
- `citations[].path`/`.symbol` are for display only; copy them from the matching hit too.
- Set `degraded` to whatever `semantic` was in the context payload's inverse (`degraded: !semantic`)
  — `true` only when you answered from keyword-only hits.
- `generated_at` is an ISO-8601 timestamp for when you wrote the file.
- If `hits` was empty: still write a valid file, with `answer` stating plainly that no relevant match
  was found, and `citations: []`. This is a complete, correct answer — not an error.

## Procedure

1. Fetch `/context` for this `job_key`. Read every hit's `summary_text`.
2. Write 2-5 sentences that actually answer the question using only what the hits say — don't pad
   with generic commentary the hits don't support.
3. Reference the hits you actually used as `[1]`, `[2]`, ... inline, in the order you introduce them.
4. Build `citations[]` from exactly the hits you referenced (drop any hit you didn't end up using —
   citing something irrelevant is worse than a shorter citation list).
5. Fetch `/path` and write the file there. Confirm the JSON you wrote parses back as valid JSON with
   a non-empty `answer` string before finishing — an unparseable or empty-answer write is treated as
   a failed run and the previous answer (if any) is restored, so a broken write helps no one.
