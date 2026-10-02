---
id: EP-A-01-01
title: "hub: expose the shared config resolver"
status: Done
kind: story
group: platform
parent: EP-A-01
---

## Acceptance Criteria

- [x] `resolve_config()` returns the same object for every caller in one process.
- [x] A missing config file falls back to defaults without raising.
