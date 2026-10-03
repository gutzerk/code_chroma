# Feature Specification: Canvas customization

**Feature Branch**: `001-canvas-customization`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Canvas customization — background color, block style, arrow colors, and an element-count limit, configurable from Settings (EP-4)."

## User Scenarios & Testing *(mandatory)*

<!--
  User stories prioritized as user journeys ordered by importance.
  Each story is independently testable — implementing just one delivers a viable MVP slice.
-->

### User Story 1 - Choose canvas appearance (background color, block style, arrow color) (Priority: P1)

A developer opens Settings and picks the canvas background color, a block style (default / minimal /
high-contrast), and the arrow color used for drawn relations. The canvas applies the choices live,
immediately, without a reload, and the same look is still there after they close and reopen Settings.

**Why this priority**: This is the heart of the epic — giving the user control over appearance. It
delivers the primary value (the map presents how the user wants) and must land first because the
element-count limit (P2) builds on the same Settings + style-engine plumbing.

**Independent Test**: Full flow can be tested alone — open Settings, change each of the three
appearance controls, verify the canvas updates live and the choices persist across a reload. Delivers
appearance customization as a complete, usable slice without the element limit.

**Acceptance Scenarios**:

1. **Given** a canvas with default appearance, **When** the user sets a new background color in Settings, **Then** the canvas background changes to that color immediately without reloading.
2. **Given** the default block style active, **When** the user selects the high-contrast block style, **Then** block fills are redrawn in the high-contrast treatment immediately.
3. **Given** the default arrow color, **When** the user sets a new arrow color, **Then** all drawn relations use the new color immediately.
4. **Given** the user has changed any appearance setting, **When** they reload the app and reopen the canvas, **Then** the chosen values are applied (persisted) rather than the defaults.

---

### User Story 2 - Set a maximum number of elements to render (Priority: P2)

A developer maps a large codebase and wants to limit how much of it renders at once. They set a
maximum element count in Settings, and the canvas honors that limit when deciding what to draw,
trading density for legibility. A sensible default applies until they change it.

**Why this priority**: Important for legibility on large maps, but it is a second slice — it reuses
the Settings and persistence plumbing from P1 and only then adds the render-budget behavior.

**Independent Test**: Can be tested alone once Settings exists — set the element limit, load a large
map that would otherwise exceed it, and verify the rendered element count does not exceed the
configured limit.

**Acceptance Scenarios**:

1. **Given** the configured element limit is lower than the map's total, **When** the canvas renders, **Then** the number of elements rendered does not exceed the configured limit.
2. **Given** no element limit has been set, **When** the canvas renders, **Then** a sensible default limit applies.
3. **Given** the user has set an element limit, **When** they reload the app, **Then** the configured limit is still enforced (persisted).

---

### User Story 3 - Present a clean high-contrast map on a stand (Priority: P3)

A demo lead, before presenting, opens Settings and switches the map to the high-contrast block style
so the live canvases read well on a stand. The choice is applied and persists so the stand shows the
same clean look for the session.

**Why this priority**: A presentation nicety on top of P1. It exercises the same controls but for a
distinct audience and presentation context, so it is a lower-priority, additive slice.

**Independent Test**: Can be tested alone — open Settings, choose high-contrast, verify the map
presents with sufficient contrast to read on a display and the choice persists for the session.

**Acceptance Scenarios**:

1. **Given** the high-contrast block style is selected, **When** the map is displayed on a projection/stand, **Then** blocks and relations are legible (sufficient contrast against the chosen background).
2. **Given** the demo lead set high-contrast, **When** the session continues or the app reloads, **Then** the high-contrast choice is still applied.

---

### Edge Cases

- What happens when the user selects a background color that makes the default arrow color low-contrast? → The chosen colors are applied as-is (user control wins); legibility is the user's responsibility, but defaults are chosen to be legible together.
- How does the system handle an element-count limit of zero or a negative value? → The system applies a sensible minimum (e.g., never below 1) rather than rendering nothing or erroring.
- How does the system handle an element-count limit larger than the full map? → The canvas renders the whole map; the limit only caps density, it never blocks rendering the full map.
- How does the system behave when no settings have been saved yet? → Defaults apply until the first change.
- What if the user resets preferences mid-session after customized values? → The style engine reapplies the chosen (or default) values live.
- How are persisted values recovered if storage is unavailable or corrupt? → The system falls back to defaults without breaking the canvas.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Settings panel MUST expose a background-color picker for the canvas.
- **FR-002**: Settings panel MUST expose a block-style selector offering at least "default", "minimal", and "high-contrast".
- **FR-003**: Settings panel MUST expose an arrow-color picker used for drawn relations.
- **FR-004**: The style engine MUST resolve the chosen background color, block style, and arrow color into theme variables that the canvas consumes.
- **FR-005**: The canvas MUST apply appearance changes live (reflect the new value immediately) without requiring a reload.
- **FR-006**: Settings panel MUST expose a control for the maximum number of elements the canvas renders.
- **FR-007**: The render budget MUST honor the configured element limit when deciding what to draw.
- **FR-008**: A sane default MUST apply for each setting until the user changes it.
- **FR-009**: The user's choices MUST persist and still hold across a reload.
- **FR-010**: The canvas MUST remain functional and defaulted if persisted settings are missing or cannot be read.

*Note on scope boundaries:* Per-diagram overrides baked into individual `.json` files (`meta.style`)
already exist and are explicitly out of scope — unchanged by this feature. No change to the semantic
map model itself.

### Key Entities *(include if feature involves data)*

- **User Settings / Preferences**: The set of user-configurable values (background color, block style, arrow color, element limit). Key attributes: each value's current selection and whether a default or user-chosen value is in effect. Persisted so it survives reloads.
- **Style Engine Output (Theme Variables)**: The resolved appearance values the canvas consumes. Relates a selected setting to concrete render values; produced by the style engine from User Settings.
- **Render Budget**: Decides which elements the canvas draws. Consumes the configured element limit and enforces it against the available elements.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can change background color, block style, and arrow color, and the canvas reflects all three changes immediately, without a reload, in every case tested.
- **SC-002**: 100% of appearance changes made in Settings persist across a reload (verified by: change a value, reload, observe the value still applied).
- **SC-003**: When an element limit lower than the map total is configured, the rendered element count never exceeds the configured limit.
- **SC-004**: A user who has never changed a setting sees the default look and default element limit (no broken/blank canvas on first run).
- **SC-005**: A demo lead can switch the map to high-contrast and have the canvas read legibly on a stand with no reload or manual styling.
- **SC-006**: The canvas remains fully functional (renders the map, applies settings) when persisted settings are absent or unreadable, falling back to defaults.

## Assumptions

- The Settings panel and the style engine already exist or are introduced as part of this work; EP-4 depends on EP-1 (zoomable semantic map) for the canvas to already render a map.
- The three block styles are "default", "minimal", and "high-contrast", matching the epic's stated options.
- Appearance values (background color, arrow color) are simple color selections from a picker; no free-form theming or layout changes are in scope beyond appearance.
- The element limit is a single maximum-count cap; there is no separate minimum or per-layer limit in scope.
- Persistence is local to the user's installation/session and does not require cross-device sync.
- The default color combination is chosen to be legible together so first-run users get a sane appearance.
- These outcomes are judged on the user's installed/run app behavior; automated and manual verification are both acceptable ways to confirm them.
