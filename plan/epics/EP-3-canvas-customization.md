---
id: EP-3
title: "Canvas customization"
status: Planned
kind: epic
group: settings
priority: Medium
depends_on:
  - id: EP-1
    title: "the zoomable semantic map"
---

## Summary

Let the user customize how the canvas looks and how much it renders via a Settings panel: background color, block style, arrow colors, and the number of elements displayed.

## Acceptance Criteria

- [ ] Settings panel exposes background color, block style, and arrow-color pickers.
- [ ] A style engine resolves the chosen settings into theme variables the canvas consumes.
- [ ] The element-count limit is user-configurable and enforced by the render budget.
