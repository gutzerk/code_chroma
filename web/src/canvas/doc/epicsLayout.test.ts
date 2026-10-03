import { describe, expect, it } from "vitest";
import type { CanvasDoc, CanvasElement } from "../../state/types";
import { fitContentHeight, fitContentWidth, isEpicsLayer, layoutEpics, storyGroupCount } from "./epicsLayout";
import { specStories } from "./specStories";

interface Spec {
  id: string;
  render: "epic" | "spec" | "task" | "group";
  recipeKey: string;
  label?: string;
  layer?: string;
  groupId?: string | null;
  size?: { w: number; h: number } | null;
  meta?: Record<string, string>;
}

/** Builds an epics-shaped document: domain frames + epic boxes + stories, reflecting how the recipe
 * projects them (group_id top-level, recipe_key meta, no order/lane). */
function buildDoc(specs: Spec[]): CanvasDoc {
  const elements: Record<string, CanvasElement> = {};
  for (const s of specs) {
    elements[s.id] = {
      id: s.id,
      render: s.render,
      layer: s.layer ?? "epics",
      label: s.label ?? s.recipeKey,
      description: "",
      node_id: null,
      group_id: s.groupId ?? null,
      position: { x: 0, y: 0 },
      size: s.size ?? null,
      meta: { recipe_key: s.recipeKey, ...s.meta },
      created_by: "ai",
    } as CanvasElement;
  }
  return { schema_version: 1, doc_id: "doc", layers: {}, elements, edges: {} } as unknown as CanvasDoc;
}

/** Mirrors the real epics fixture: 4 epics (bare keys) + 2 stories under EP-3. */
function epicFixture(): CanvasDoc {
  return buildDoc([
    { id: "epic-1", render: "epic", recipeKey: "EP-1" },
    { id: "epic-2", render: "epic", recipeKey: "EP-2" },
    { id: "epic-3", render: "epic", recipeKey: "EP-3" },
    { id: "epic-4", render: "epic", recipeKey: "EP-4" },
    { id: "story-1", render: "spec", recipeKey: "EP-3::logging" },
    { id: "story-2", render: "spec", recipeKey: "EP-3::config" },
  ]);
}

describe("epicsLayout", () => {
  it("detects an epics-layer batch", () => {
    const doc = epicFixture();
    expect(isEpicsLayer(doc, ["epic-1"])).toBe(true);
    expect(isEpicsLayer(doc, ["not-an-epic"])).toBe(false);
  });

  it("detects a per-epic epics/<id> layer batch", () => {
    const doc = buildDoc([
      { id: "epic-2", render: "epic", recipeKey: "EP-2", layer: "epics/EP-2" },
    ]);
    expect(isEpicsLayer(doc, ["epic-2"])).toBe(true);
  });

  it("places each epic in its own column, stories stacked under their epic", () => {
    const doc = epicFixture();
    const ids = Object.keys(doc.elements);
    const { positions } = layoutEpics(doc, ids);

    // Every box gets a distinct (x, y) -- the (0,0) pile-up is impossible.
    const seen = new Set<string>();
    for (const id of Object.keys(positions)) {
      const key = `${positions[id].x},${positions[id].y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }

    // Stories hang vertically under their parent epic, in the same column.
    const epic3 = positions["epic-3"];
    expect(positions["story-1"].x).toBe(epic3.x);
    expect(positions["story-1"].y).toBeGreaterThan(epic3.y);
    expect(positions["story-2"].x).toBe(epic3.x);
    // Stories without a phase number sort deterministically by recipe_key, so `config` (story-2)
    // lands above `logging` (story-1) -- not by input order.
    expect(positions["story-2"].y).toBeLessThan(positions["story-1"].y);

    // Separate epics land in distinct columns (differing x).
    const xs = new Set(["epic-1", "epic-2", "epic-3", "epic-4"].map((id) => positions[id].x));
    expect(xs.size).toBe(4);
  });
});

/** The full-graph shape (EP-4 · canvas customization): one epic → its phase-specs → their tasks,
 * with every box's `recipe_key` carrying the full ancestry (`EP-4` / `EP-4::phase-1` /
 * `EP-4::phase-1::T001`). No group frames on the inner spec/task boxes -- structure comes from
 * recipe_key, and the layout must not depend on frames. */
function fullGraphFixture(): CanvasDoc {
  // Deliberately out of order in the projection dict (the recipe projects elements in hash-id
  // order), so a ph2 task, a ph3 spec and the epic land first -- the layout must sort them back into
  // epic → ph2 → its task → ph3 → its tasks regardless of input order.
  return buildDoc([
    { id: "t011", render: "task", recipeKey: "EP-4::phase-3::T011" },
    { id: "epic", render: "epic", recipeKey: "EP-4" },
    { id: "spec-appearance", render: "spec", recipeKey: "EP-4::phase-3", label: "Phase 3 · US1" },
    { id: "t012", render: "task", recipeKey: "EP-4::phase-3::T012" },
    { id: "spec-foundation", render: "spec", recipeKey: "EP-4::phase-2", label: "Phase 2 · Foundational" },
    { id: "t003", render: "task", recipeKey: "EP-4::phase-2::T003" },
  ]);
}

describe("epicsLayout full graph", () => {
  it("stacks epic → cards, then lays phases out in a row with each phase's tasks under it", () => {
    const doc = fullGraphFixture();
    const ids = Object.keys(doc.elements);
    const { positions } = layoutEpics(doc, ids);

    // Every box gets a distinct (x, y) -- the (0,0) pile-up is impossible.
    const seen = new Set<string>();
    for (const id of Object.keys(positions)) {
      const key = `${positions[id].x},${positions[id].y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }

    // The root epic sits alone at its column; its phase-specs sit BELOW it (larger y).
    const epicY = positions["epic"].y;
    expect(positions["spec-foundation"].y).toBeGreaterThan(epicY);
    expect(positions["spec-appearance"].y).toBeGreaterThan(epicY);

    // Phases lay out in a horizontal ROW: distinct x, shared y (aligned tops), ordered by phase no.
    expect(positions["spec-foundation"].x).not.toBe(positions["spec-appearance"].x);
    expect(positions["spec-foundation"].x).toBeLessThan(positions["spec-appearance"].x);
    expect(positions["spec-foundation"].y).toBe(positions["spec-appearance"].y);

    // Each phase's task sits under its own phase (same x, larger y).
    expect(positions["t003"].x).toBe(positions["spec-foundation"].x);
    expect(positions["t003"].y).toBeGreaterThan(positions["spec-foundation"].y);
    expect(positions["t011"].x).toBe(positions["spec-appearance"].x);
    expect(positions["t011"].y).toBeGreaterThan(positions["spec-appearance"].y);
    expect(positions["t012"].y).toBeGreaterThan(positions["t011"].y);
  });

  it("sorts phases by phase number into a row and keeps each spec's tasks under it, even on out-of-order input", () => {
    const doc = fullGraphFixture();
    const ids = Object.keys(doc.elements);
    const { positions } = layoutEpics(doc, ids);

    // ph2 (foundation) lands to the LEFT of ph3 (appearance), both sharing a y (row) below the epic.
    expect(positions["spec-foundation"].y).toBe(positions["spec-appearance"].y);
    expect(positions["spec-foundation"].x).toBeLessThan(positions["spec-appearance"].x);
    // Each spec's task sits under its own spec, all in the same row (equal y per spec).
    expect(positions["t003"].x).toBe(positions["spec-foundation"].x);
    expect(positions["t003"].y).toBeGreaterThan(positions["spec-foundation"].y);
    expect(positions["t011"].x).toBe(positions["spec-appearance"].x);
    expect(positions["t012"].x).toBe(positions["spec-appearance"].x);
    expect(positions["t011"].y).toBeGreaterThan(positions["spec-appearance"].y);
    expect(positions["t012"].y).toBeGreaterThan(positions["t011"].y);
  });

  it("records a group frame at its center so it wraps its members instead of landing on them", () => {
    // EP-4 carries a domain group frame that the epic box hangs under (group_id names it).
    const doc = buildDoc([
      { id: "frame", render: "group", recipeKey: "__group__::EP-4", groupId: null },
      { id: "epic", render: "epic", recipeKey: "EP-4", groupId: "frame", size: { w: 760, h: 72 } },
      { id: "spec", render: "spec", recipeKey: "EP-4::foundation", groupId: "frame", size: { w: 300, h: 84 } },
    ]);
    const ids = Object.keys(doc.elements);
    const { positions } = layoutEpics(doc, ids);

    const f = positions["frame"];
    // The frame's recorded position is its CENTER (frames aren't in the bottom-left set, so the
    // renderer still draws them from their center), so its x-center lines up with its members'
    // column's center — it does not drift half its width right/left onto them. Members share a
    // bottom-left x=0. The epic title box is NOT a content card (no summary/acceptance meta), so it
    // keeps its authored width 760 — the widest member — and the frame centers on 380.
    expect(f.x).toBe(positions["epic"].x + 760 / 2);
    // The frame's vertical center sits past the epic's own bottom-left y (so it wraps the epic and
    // the spec beneath it) — it does not land on top of the epic box.
    expect(f.y).toBeGreaterThan(positions["epic"].y);
    expect(f.y).toBeLessThan(positions["spec"].y + 42);
  });

  it("advances the next column past a wide Summary block, never overlapping it", () => {
    // EP-4 carries a wide Summary card (w 480) under the epic; EP-1 is a separate root column.
    const doc = buildDoc([
      { id: "epic", render: "epic", recipeKey: "EP-4" },
      { id: "summary", render: "spec", recipeKey: "EP-4::summary", size: { w: 480, h: 180 } },
      { id: "epic1", render: "epic", recipeKey: "EP-1" },
    ]);
    const ids = Object.keys(doc.elements);
    const { positions } = layoutEpics(doc, ids);

    const epicX = positions["epic"].x;
    const summaryX = positions["summary"].x;
    const epic1X = positions["epic1"].x;
    // Summary sits under the epic in the same column …
    expect(summaryX).toBe(epicX);
    expect(positions["summary"].y).toBeGreaterThan(positions["epic"].y);
    // … and the next root column starts to the right of the wide Summary's right edge.
    expect(epic1X).toBeGreaterThan(epicX + 480);
  });
});

describe("fitContentWidth", () => {
  function el(overrides: Partial<CanvasElement> & { id: string }): CanvasElement {
    return { render: "epic", layer: "epics", label: "EP-4", description: "", node_id: null,
             position: { x: 0, y: 0 }, size: null, group_id: null, meta: {}, created_by: "ai",
             ...overrides } as CanvasElement;
  }

  it("sizes a structured \\n list (Acceptance criteria) to its widest line", () => {
    const w = fitContentWidth(el({
      id: "a",
      description: "Settings exposes background, block-style and arrow-color pickers.\nStyle engine resolves the chosen settings into theme variables the canvas consumes.\nA sane default applies; choices persist.",
    }));
    // The widest criterion is the ~75-char "Style engine … consumes." line: chars × CHAR_WIDTH + pad.
    expect(w).toBeGreaterThan(640);
    expect(w).toBeLessThanOrEqual(1480);
    // A longer widest line yields a strictly wider box than a shorter one.
    const shorter = fitContentWidth(el({ id: "b", description: "Short.\nAlso short." }));
    expect(w).toBeGreaterThan(shorter);
  });

  it("sizes prose (Summary) to the fixed reading column regardless of exact text", () => {
    const w = fitContentWidth(el({ id: "s", description: "Today the canvas has one fixed look: a hardcoded background..." }));
    expect(w).toBe(860);
  });

  it("sizes a bare title to the content floor (never narrower than a readable box)", () => {
    expect(fitContentWidth(el({ id: "t" }))).toBe(640);
  });
});

describe("fitContentHeight", () => {
  function el(overrides: Partial<CanvasElement> & { id: string }): CanvasElement {
    return { render: "epic", layer: "epics", label: "EP-4", description: "", node_id: null,
             position: { x: 0, y: 0 }, size: null, group_id: null, meta: {}, created_by: "ai",
             ...overrides } as CanvasElement;
  }

  it("adds per-story chrome on top of a iterative line count for a Спеки card", () => {
    // Four stories, each with a why line and a handful of criteria.
    const h = fitContentHeight(el({
      id: "s",
      meta: { specs: "1" },
      description:
        "US1 · Choose canvas appearance (P1 · MVP)\nЯдро эпика: дать контроль над внешним видом.\nA.\nB.\nC.\n\n" +
        "US2 · Set maximum element count (P2)\nЛимит элементов ниже числа на карте.\nA.\nB.\n\n" +
        "US3 · High-contrast stand presentation (P3)\nДемо-лид включает high-contrast для читаемости.\nA.",
    }), 800);
    // rows (1+1+3 + 1+1+2 + 1+1+1 = 12) × LINE_HEIGHT + chrome 88 + groups (3) × STORY_PAD 18.
    expect(h).toBe(88 + 12 * 21 + 3 * 18);
  });

  it("counts a structured \\n list (Acceptance) as rows × line height plus chrome", () => {
    const h = fitContentHeight(el({ id: "a", description: "A.\nB.\nC." }), 800);
    expect(h).toBe(88 + 3 * 21);
  });

  it("wraps a prose Summary to the fitted width before counting lines", () => {
    const h = fitContentHeight(el({ id: "p", description: "x".repeat(400) }), 800);
    // Wider box → wider rows → fewer lines than the same text in a narrow box.
    const narrow = fitContentHeight(el({ id: "p", description: "x".repeat(400) }), 400);
    expect(h).toBeLessThan(narrow);
  });

  // `fitContentHeight` sizes a «Спеки» card off `storyGroupCount` (every blank-line group) while
  // `specStories` (in CanvasNodeBox) draws a card only per `US# ·` group. The reflow that persists
  // `size.h` from the estimate stays in one pass only if the estimate is never SHORT for a group the
  // renderer WILL draw, or the first story overlaps the box above. `storyGroupCount` may over-count a
  // stray/non-US group (safe — the reflow shrinks it), but must never under-count a US group.
  it("never under-counts a group the renderer draws as a story card", () => {
    const cases = [
      // An intro paragraph (renders, no card) + one US story (one card draws).
      "An intro line.\n\nUS1 · A story (P1)\nWhy line.\nA.\nB.",
      // Three stories, two with an intro.
      "Intro here.\n\nUS1 · One (P1)\nA.\n\nUS2 · Two (P2)\nB.\nC.\n\nUS3 · Three (P3)\nD.",
      // A stray non-US paragraph between stories — the renderer skips it.
      "US1 · One (P1)\nA.\n\nstray filler\n\nUS2 · Two (P2)\nB.",
    ];
    for (const description of cases) {
      const renderedCards = specStories(description).filter((s) => s.title).length;
      // The height estimate keys off group count; it must count every US group the renderer draws
      // (and may also count non-US intro/stray groups — that over-count is the safe direction).
      expect(storyGroupCount(description)).toBeGreaterThanOrEqual(renderedCards);
      // And a card the renderer draws must never be estimated away: its story needs chrome + a title
      // row in the fitted height, or the reflow would grow the box and straddle two passes.
      const minForCards = 88 + renderedCards * (21 + 18);
      expect(fitContentHeight(el({ id: "s", meta: { specs: "1" }, description }), 800))
        .toBeGreaterThanOrEqual(minForCards);
    }
  });
});

describe("layoutEpics measured heights", () => {
  it("uses a supplied measured height for a content card instead of the estimate", () => {
    // The specs card's estimate is far below the real 580px its story cards render at.
    const doc = buildDoc([
      { id: "epic", render: "epic", recipeKey: "EP-4" },
      {
        id: "specs",
        render: "spec",
        recipeKey: "EP-4::specs",
        meta: { specs: "1" },
      },
    ]);
    const ids = Object.keys(doc.elements);
    const est = layoutEpics(doc, ids);
    const measured = layoutEpics(doc, ids, { specs: 580 });
    expect(measured.sizes["specs"].h).toBe(580);
    expect(measured.sizes["specs"].h).toBeGreaterThan(est.sizes["specs"].h);
    // A taller specs card pushes its own bottom edge lower, so its position.y grows too.
    expect(measured.positions["specs"].y).toBeGreaterThan(est.positions["specs"].y);
  });
});
