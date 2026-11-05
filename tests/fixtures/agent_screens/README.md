# Agent screens

Rendered screens, one folder per agent CLI, that the status rule engine must classify. Both bridges
run the same table: `cases.json` lists each case's detector `kind`, its `screen` file (or inline
`lines`), optional OSC `title` / `progress`, the `expected` state (`null` = hold), the winning
`rule` id (`null` = no rule matched) and the `visible_blocker` flag.

- Python: `tests/unit/test_agent_status.py`
- C#: `dotnet/CodeChroma.Bridge.Tests/Agents/StatusDetectorTests.cs`

The screens follow the layouts the herdr manifests (Apache-2.0) were written against. Keep at least
one false-positive case per agent: dialog text quoted in scrollback must not read as `blocked`.
