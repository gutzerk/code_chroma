---
id: EP-A-01-02
title: "hub: unify the logging format"
status: In progress
kind: story
group: platform
parent: EP-A-01
---

## Acceptance Criteria

**Given** a service emits a log line
**When** it is written to stdout
**Then** it is valid JSON carrying a `service` and a `level` field
— docs/logging.md §2

**Illustrative** — shown for context only, not an additional criterion.
**Given** a developer tails the log locally
**When** they grep for `level=error`
**Then** they see only error lines
