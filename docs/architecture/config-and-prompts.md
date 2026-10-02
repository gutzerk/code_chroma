# Config and prompts (`src/codechroma/config.py`, `src/codechroma/prompts/`)

Every tunable limit/timeout/model-name that used to sit as a bare module-level constant next to the
code it configured (e.g. `context/structure.py`'s `DEFAULT_DEPTH`, `bridge/agents/manager.py`'s
`MAX_AGENTS`) now has one source of truth in `config.py`, and every Claude system/user prompt that
used to be an inline string constant (e.g. `context/patterns_generator.py`'s `_SYSTEM_PROMPT`) now lives in
`prompts/*.yaml`. Neither module does anything clever — they exist so the same default is defined
once and every consumer imports it, instead of the same idea (a timeout, a token cap, a prompt's
wording) drifting across files that each hardcoded their own copy.

## `config.py`

One pydantic `Settings` object (`settings = Settings()`), built from ~20 frozen `BaseModel` groups —
one per subsystem, named after the module it configures (`StructureConfig`, `AgentsConfig`,
`PublishConfig`, …). Each group's docstring names the file it replaced. A consuming module reads the
value **at call time**, not at import — so a custom `Settings(...)` built first actually takes
effect:

```python
from codechroma.config import settings

def gh_timeout() -> int:
    return settings.publish.gh_timeout_seconds
```

Most modules expose a small module-level *function* (`gh_timeout()`, `max_agents()`,
`max_pr_workspaces()`, …) that reads `settings.<group>.<field>` lazily, rather than a bare constant
snapshot, because the old import-time constants made it impossible for two apps in one process to
differ in config. Where a value has a single call site it is read inline. The handful of constants
that tests or other modules still import by name (e.g. `MAX_AGENTS`) became functions and those
importers were updated in the same change (plan-04).

🔴 Not migrated: reason-code/state-tag string constants (`STATUS_IDLE`, `REASON_GH_MISSING`, …) and
env-var *names* (`TIMEOUT_ENV_VAR = "codechroma_C1_TIMEOUT_SECONDS"`). Those aren't tunable defaults —
they're protocol constants (a fixed vocabulary other code branches on) and identifiers tied to an
external env var someone may already export, respectively. Moving either into `config.py` would add
a layer without adding a way to reuse or override anything.

⚠ `bridge/git_long.py` is a deliberate exception to the "one frozen default" rule: `timeout_seconds()`
re-reads `codechroma_GIT_LONG_TIMEOUT_SECONDS` from the environment **on every call**, falling back to
`settings.git.long_timeout_seconds` only when the env var is unset or unusable — so a slow remote can
be accommodated without restarting the bridge. Freezing that into a `Settings` field read once at
import would silently break that.

To override anything, construct your own `Settings(...)` (each field takes a keyword) rather than
mutating `settings` — every model is frozen.

## `prompts/`

`prompts/<name>.yaml` holds the prompt(s) for the module of the same name (`ai_summarizer.yaml`,
`patterns_generator.yaml`, `c1_agent.yaml`, `patterns_agent.yaml`,
`impact_review_agent.yaml` (the review axis moved here from `c1_review_agent.yaml` post-038), plus
one per composite/bare skill runner added since — `research_agent.yaml`, `epic_brief_agent.yaml`,
…), keyed `system:`/`user:`/`prompt:`.
`prompts/__init__.py`'s
`render_prompt(name, key="prompt", **variables)` reads it back (cached via `functools.cache`) and,
**only if `variables` are passed**, `.format(**variables)`s the template.

🔴 That "only if variables are passed" guard is load-bearing, not incidental: a system prompt like
`patterns_generator.yaml`'s contains a literal JSON schema in braces
(`{"confirmations": [{"id": str, ...}]}`). Calling `.format()` on it with no substitutions would
raise on those braces. `render_prompt` is called with zero kwargs for every static prompt (the
skill-agent `PROMPT`s, and the `system:` templates) and with kwargs only for the genuinely templated
`user:` prompts (`ai_summarizer`'s `{node_level}`/`{node_name}`/`{context}`, `patterns_generator`'s
`{candidates_json}`) — never mix the two for the same template.

## The shared Claude call: `context/llm_provider.py`

`AISummarizer` and `patterns_generator.generate_patterns` each make one
call through the shared `LLMProvider` protocol (`.complete(user=, model=, max_tokens=,
system=None)`), so that "unwrap the response text" plumbing exists once rather than twice.
`context/c1_template.py`'s bootstrap makes no such call at all (043) — it is a pure table lookup.
Each call site first resolves its own assignment via `build_provider(load_assignment(call_site_id))`
(see [`llm-settings.md`](llm-settings.md) for the full per-call-site provider/model feature); an
unassigned call site falls back to today's `provider_from_env()` — an `AnthropicProvider` built from
`ANTHROPIC_API_KEY` (assistant settings or env). `settings.anthropic_client.request_timeout_seconds`
(30s) bounds every `AnthropicProvider`/`OpenAICompatibleProvider` call — long enough for a real call,
short enough that a bridge-startup bootstrap call can't hang the process. `Anthropic` is only
imported lazily inside `provider_from_env()`/`provider_to_llm()` (module top level only imports it
under `TYPE_CHECKING`) so a missing/broken `anthropic` install degrades to `None` (offline summaries)
exactly like `AISummarizer.from_env()`'s own `ImportError` guard, instead of crashing at import time
— the engine's "works end-to-end with no credentials either way" claim (see the top-level
`CLAUDE.md`) depends on both guards existing.
