---
# ── Business half — the PM owns every field below ──────────────────────────────
id: "EP-4"
title: "Canvas customization — background color, block style, arrow colors, and an element-count limit, configurable from Settings"
name: "Let the user shape how the canvas looks and how much it renders — background color, block style, arrow colors, and an element-count limit"
status: "Planned"
kind: "epic"
group: "settings"
priority: "Medium"
references:
  - "plan/epics/EP-1-zoomable-semantic-map.md"
  - "web/src/canvas/RootCanvas.tsx"
  - "web/src/styles.css"
---

# EP-4: Canvas customization

## 1. Summary

Today the canvas has one fixed look: a hardcoded background, a single block style, and one set of
arrow colors, and it always renders up to whatever the fixed budget allows. This epic lets the user
shape how the canvas looks and how much of it renders — background color, block style, arrow colors,
and the number of elements displayed — through a Settings panel. The person who benefits is the
developer who maps a particular codebase and wants the view to match how they read it, and the team
stand/demo where the map should present cleanly. Specifically: the style is currently hardcoded in
theme constants, so the work is to make those values user-configurable and to have the canvas consume
them live, without a reload.

## 2. Problem / Opportunity

- **The canvas has one hardcoded look.** Background, block fills, and arrow colors are fixed theme
  constants — web/src/styles.css — so no user can adapt the map to their preference or to a
  presentation context.
- **The user has no say in how much renders.** The element budget is a baked-in render cap; there is
  no way to trade density for legibility or vice versa.

## 3. Capability & Outcome

- **Capability delivered:** a user opens Settings, picks background color, block style, arrow color,
  and an element-count limit, and the canvas applies them live, keeping a sensible default until
  changed.
- **Outcome, judged on:**
  - A developer can make the map present the way they read a codebase.
  - The settings persist and still hold across a reload.

## 4. Scope

**In scope**

- Background color selection for the canvas.
- Block style (default / minimal / high-contrast).
- Arrow color used for drawn relations.
- A configurable maximum number of elements the canvas renders.
- A style engine that resolves the chosen settings into theme variables the canvas consumes.
- Persistence of the user's choices.

**Out of scope / non-goals**

- Per-diagram overrides baked into individual `.json` files (`meta.style`) — that already exists and
  is unchanged.
- Any change to the semantic map model itself.

## 5. Key User Stories *(seed only)*

| As a… | I want to… | So that… |
|---|---|---|
| A developer | Set the background and arrow colors of the map | The view matches how I read a codebase |
| A developer | Choose a block style and an element limit | I can trade density for legibility when a map is large |
| A demo lead | Present a clean, high-contrast map | The live canvases read well on a stand |

## 6. Acceptance Criteria

**Checklist**

- [ ] The Settings panel exposes background color, block style, and arrow-color pickers.
- [ ] The style engine resolves the chosen settings into theme variables the canvas consumes.
- [ ] The element-count limit is user-configurable and enforced by the render budget.
- [ ] A sane default applies until the user changes the value, and choices persist across reloads.

## 7. Dependencies & Sequencing

- **Depends on:** EP-1
- **Enables:** (none)

---
