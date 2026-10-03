---
id: EP-1
title: "Zoomable semantic map"
status: In progress
kind: epic
group: platform
priority: Critical
---

## Summary

The core of CodeChroma: turns any repository into a semantic, zoomable architecture map (System → Pillar → Component → Service → Function → Logic → Code) that the canvas UI live-renders.

## Acceptance Criteria

- [x] The engine resolves a real dependency/caller graph from a repository's file tree.
- [x] The canvas renders a zoomable map with semantic zoom and panels.
- [ ] LLM summaries enrich every node with a one-sentence description when credentials are set.
