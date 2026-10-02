---
id: EP-A-02
title: "Integration: connect the billing pipeline"
status: Planned
kind: epic
depends_on:
  - id: EP-A-01
    title: "the foundation epic"
enables:
  - id: EP-Z-99
    title: "a future reporting epic"
---

## Success Criteria *(billing)*

- [ ] Billing events publish onto the shared bus.
- [ ] A failed publish retries with backoff.
