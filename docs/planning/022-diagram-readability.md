# 022 — Diagram readability: blocks, sequence (two switchable modes), impact

Status: In progress — Stages 1–4 and the ▶ player landed; open: Playwright visual checks for impact/C1 and the 5-second test on three real diagrams; non-sequence skill refs and the checker now ask for `question`/`summary`/`hero` (#277), `order`/`lane` stay sequence/process-only

Source: the "Diagram Readability Options" design canvas (boards Recommendation, A4 Glance + expand, B2 Route overlay, Blocks 1–2, Sequence 1–2, Impact). Builds on `docs/architecture/diagram-skills.md` and `docs/architecture/web-canvas-shell.md`.

## Problem

Diagrams draw fine but do not read in five seconds. The renderer can already number, lane and highlight, but the skill never supplies `order`, `lane`, `hero` edges or a summary, so boxes carry a role badge plus a grey paragraph and sequence diagrams show every message at once.

## Goal

After 5 seconds a reader can name the start, the result, and which step uses AI. Fix the data first, then the drawing, then add interaction.

## Decision: sequence has two modes, switchable live

Both sequence designs ship. The user flips between them on the diagram, without redrawing and without a reload.

| Mode | Board | What it is | Default for |
|---|---|---|---|
| `readable` | Sequence 1 | Everything visible: phase bands on the left, numbered messages, alt/loop frames, notes, a legend | Diagrams of up to 12 messages |
| `focus` | Sequence 2 | Phases collapse to one row (`▸ 2 · Prepare`), one participant is focused, its messages stay lit and the rest fade, a timeline side panel | Diagrams of more than 12 messages |

Rules for the switch:

- Same data, two views. The mode is a display preference, never written to `sequence.json` and never part of the persisted element geometry.
- Control: a two-button segmented control (`Readable | Focus`) in the diagram's frame header (`DiagramFrame.tsx`). `Collapse all`, `Expand all` and the focus chip appear only in `focus` mode.
- Preference store: `sequenceViewStore.ts` (per diagram `layer`, in `localStorage`, wrapped in try/catch; the page renders correctly without it). Initial value is the default from the table above.
- Switching re-renders in place. Collapse state and focus survive a switch back and forth (they live in the store, not in component state).
- Both modes read the same `phases[]` and `order`; `readable` ignores collapse and focus.

## Stage 1 — Skill data (no renderer change, about 1 day)

Files: `skills/codechroma-draw-diagram/` (`SKILL.md`, `references/drawing-rules.md`, `references/type-sequence.md`, `references/bare-sequence.md`, `scripts/check_diagram.py`), `src/codechroma/diagrams/`, `dotnet/CodeChroma.Bridge/Routes/DiagramRoutes.cs`.

1. `order` and `lane` required on every node/message; `NO-ORDER` is an advisory, so older diagrams keep passing.
2. Edges on the main path get `hero: true`.
3. Top-level `question` and `summary` strings.
4. `phases[]` for sequences: `{id, name, kind, from_order, to_order}` where `kind` is one of `request | prepare | ai | deliver | custom`. Optional `frames[]` for `alt | loop` with `{kind, label, from_order, to_order}` and optional `notes[]` anchored to a message.
5. Wording lints: `ECHO-LABEL` (label repeats the title), `HIDDEN-BRANCH` (a failure path with no visible label). Title of 4 words or fewer, purpose of one line.
6. Both resolvers (`_resolve_sequence` in Python, `DiagramRoutes.cs`) pass `phases`, `frames`, `notes` into element `meta`. Python and C# stay in step; add the golden/parity cases.
7. Tests: `tests/unit/test_diagram_check_script.py`, `test_diagram_registry.py`, the C# route tests. Docs: `diagram-skills.md`, `type-sequence.md`.

Exit check: re-draw one existing process diagram and confirm the new fields land in `meta`.

## Stage 2 — Block anatomy and layout (about 2–3 days)

Files: `web/src/canvas/doc/CanvasNodeBox.tsx`, `nodeAccent*.tsx`, `elementMeta.ts`, `web/src/canvas/connectors/elkLayout.ts`, `web/src/styles.css`.

1. Block anatomy (Blocks 1): role as icon + colour + word, status dot only when it applies, title of 4 words or fewer, one-line purpose at 14px, file path always visible, `SRC ↗` in the corner, `▸ N members` to expand in place. Pills for trigger/result, red failure boxes, dashed externals, striped planned boxes. Remove the `CONCEPTUAL` badge. Copy and `?` only on hover.
2. Zoom levels: 100% full, 60% title + `SRC ↗`, 30% title only. Colour and title never disappear. Reuse the existing zoom thresholds in `layoutMetrics.ts`.
3. Number chip in each box corner from `order`.
4. `elkLayout.ts`: when boxes carry `lane`, lay out RIGHT and partition by lane into bands. No lanes means the current layout, unchanged.
5. Groups, bundled edges with a count, and click-to-focus (Blocks 2): click a block and its direct neighbours stay lit, the rest fades to 35%. Side panel lists `CALLED BY` and `USES`; `Upstream` / `Downstream` toggles. Build on `highlighting/` rather than adding a second mechanism.
6. Tests: unit tests next to each component; Playwright visual checks so the impact and C1 views do not regress. Docs: `web-canvas-shell.md`, `c1-diagram.md`.

## Stage 3 — Sequence modes, phases, step-through (about 3 days, after Stage 1)

Files: `web/src/canvas/doc/SequenceDiagram.tsx` (split into `SequenceReadable.tsx` and `SequenceFocus.tsx` sharing a small `sequenceModel.ts`), new `sequenceViewStore.ts`, `DiagramFrame.tsx`, `autoLayout.ts` (`layoutSequence`, `SEQUENCE_LAYOUT`), `useReflowSequence.ts`, `styles.css`.

1. Extract the participant/message derivation now inline in `SequenceDiagram.tsx` into `sequenceModel.ts` (participants, messages sorted by `order`, phases, frames, notes). Both modes consume it, so the existing `SequenceDiagram.test.tsx` cases keep covering the shared part.
2. `SequenceReadable`: phase bars with a vertical label on the left, numbered labels (`3 · ensure model + cache`), return arrows dashed, AI arrows violet, event arrows dotted green, alt/loop frames, note boxes, column heads with kind and `↗`.
3. `SequenceFocus`: collapsed phase rows with call count and the participants that talk; one phase open at a time by default; click a column head to focus a participant (its messages lit, others faded); hover a column for file and callers; timeline panel with "you are here".
4. `layoutSequence` takes the mode: `focus` with collapsed phases shrinks row height for hidden messages. Geometry is derived, not persisted per mode. The mode's geometry is derived at render time (`viewSequenceElements`) and never persisted; `useReflowSequence` stays once-on-mount with the readable layout. `DiagramFrame` must keep reading the same rects, so frame drag still moves every member.
5. Mode switch control in `DiagramFrame.tsx` header, wired to `sequenceViewStore`.
6. Optional ▶ player that walks `order` and dims non-hero edges (Options B and C of the recommendation). Ship last; it depends on `order` being reliable.
7. Tests: store (default by message count, persistence, failure of storage), both renderers, the switch preserving collapse and focus, reflow on mode change. Playwright: draw, flip Readable ↔ Focus, confirm no reload and no console error.
8. Docs: `diagram-skills.md` (the "Sequence diagram" section), `web-canvas-shell.md`.

## Stage 4 — Impact at a glance (about 1–2 days, after Stage 2)

Files: the impact view components and `docs/architecture/change-cards.md` scope. Per touched box: changed/added/removed state, one-line before/after, caller count. Reuses the Stage 2 block anatomy and focus. Details come from the "Impact · Change at a glance" board.

## Board palette

Sequence phase bars, alt/loop frames, notes, AI/event arrows and the planned/data/external block shapes use the boards' colours (`styles.css`, the 022 sections); the full role-colour set and fonts still follow the app theme.

## Out of scope

- The Avalonia canvas (`dotnet/CodeChroma.Canvas*`, `AutoLayout.cs`): `web/` stays the reference. Track the port in `013-avalonia-canvas.md` after Stage 3 lands.
- Route overlay on the code map (board B2) and glance + expand (board A4): revisit after Stage 2; they depend on lanes being reliable.

## Open questions

1. Is a 12-message threshold the right default switch point between `readable` and `focus`? It is a guess from the two mock boards; tune on real diagrams.
2. Should the mode be per diagram or one global preference? The plan assumes per diagram, falling back to the size-based default.
3. Do we keep the old single renderer behind the same flag for one release? The plan assumes no: `readable` is the old look plus the new data.

## Done when

- Re-drawn diagrams carry `order`, `lane`, `hero`, `question`, `summary` and the self-check enforces them.
- A sequence diagram flips between `Readable` and `Focus` in place; a reload remembers the choice.
- The 5-second test passes on three real diagrams (a sequence, a process diagram, an impact view).
- All affected architecture docs updated in the same changes.
