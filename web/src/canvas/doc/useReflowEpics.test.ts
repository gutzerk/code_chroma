import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { CanvasDoc, CanvasElement, CanvasOp } from "../../state/types";
import type { EngineClient } from "../../engine-client/EngineClient";
import { useReflowEpics } from "./useReflowEpics";

// The hook's only side effect is the PATCH it issues for a genuine mismatch, so mock it to observe
// the ops without a real network round trip.
const patchMock = vi.fn(async (_ops: CanvasOp[]) => ({ ok: true as const }));
vi.mock("./canvasDocStore", () => ({
  patchCanvasDoc: (_client: EngineClient, ops: CanvasOp[]) => patchMock(ops),
}));

// `isContentCard` reads meta; write the element shape the hook expects directly.
function element(overrides: Partial<CanvasElement> & { id: string }): CanvasElement {
  return { render: "spec", layer: "epics", label: "EP-4::specs", description: "", node_id: null,
           position: { x: 0, y: 0 }, size: null, group_id: null, meta: {}, created_by: "ai",
           ...overrides } as CanvasElement;
}

function docWith(elements: Record<string, CanvasElement>): CanvasDoc {
  return { schema_version: 1, doc_id: "doc", layers: {}, elements, edges: {} } as unknown as CanvasDoc;
}

/** A content-height map in the shape useReflowEpics consumes (the store's `{ height }` entries). */
function contentSizesOf(entries: Array<[string, number]>): Map<string, { height: number }> {
  return new Map(entries.map(([id, height]) => [id, { height }]));
}

describe("useReflowEpics", () => {
  beforeEach(() => {
    patchMock.mockClear();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when no content card outgrew its reserved height", async () => {
    // All measured heights match `size.h` for every content card on the epics layer.
    const specs = element({
      id: "specs",
      meta: { specs: "1", recipe_key: "EP-4::specs" },
      size: { w: 1280, h: 220 },
    });
    const doc = docWith({ specs });
    const measured = contentSizesOf([["specs", 220]]);
    renderHook(() => useReflowEpics({} as EngineClient, doc, measured));
    await Promise.resolve();
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("re-lays-out with the measured height when a content card grew taller than its reserved size", async () => {
    // The layer currently sits at a real yOffset (e.g. below the hierarchy tree above it): every
    // box's laid-out `position.y` is 0 + that offset. The specs card's measured height (580) exceeds
    // the reserved 220 -> one reflow PATCH that persists both the measured height and the preserved
    // layer anchor (so the layer doesn't jump up to y=0).
    const specs = element({
      id: "specs",
      meta: { specs: "1", recipe_key: "EP-4::specs" },
      size: { w: 1280, h: 220 },
      position: { x: 0, y: 700 },
    });
    const epic = element({
      id: "epic",
      render: "epic",
      meta: { recipe_key: "EP-4" },
      size: { w: 1280, h: 72 },
      position: { x: 0, y: 560 },
    });
    const doc = docWith({ specs, epic });
    const measured = contentSizesOf([["specs", 580], ["epic", 72]]);
    renderHook(() => useReflowEpics({} as EngineClient, doc, measured));
    await Promise.resolve();
    await Promise.resolve();

    expect(patchMock).toHaveBeenCalledTimes(1);
    const ops = patchMock.mock.calls[0][0] as unknown as CanvasOp[];
    // The reflow persists the measured height (580) for the specs card, not the estimate.
    const specsOp = ops.find((o) => o.id === "specs") as { size?: { h?: number } };
    expect(specsOp.size?.h).toBe(580);
    // The layer anchor is preserved: the epic (whose size didn't change) keeps its exact y, so the
    // reflow pushes the taller specs card DOWN rather than hopping the whole column up to y=0.
    const epicOp = ops.find((o) => o.id === "epic") as { position?: { y?: number } };
    expect(epicOp.position?.y).toBe(560);
    expect((ops.find((o) => o.id === "specs") as { position?: { y?: number } }).position?.y).toBeGreaterThan(560);
  });

  it("shrinks an over-reserved root epic box to its measured height, anchoring the top edge", async () => {
    // The root epic title reserves more height (150) than its text actually renders (117) -- the empty
    // dark band under the label. The measured 117 qualifies as a shrink (|117 - 150| > 2), so the
    // reflow persists the real height AND keeps the box's current top edge fixed (its bottom-left y in
    // the doc is 560, so its top is 560 - 150 = 410; the new y keeps that top via the layer anchor).
    const epic = element({
      id: "epic",
      render: "epic",
      meta: { recipe_key: "EP-4" },
      size: { w: 640, h: 150 },
      position: { x: 0, y: 560 },
    });
    const doc = docWith({ epic });
    const measured = contentSizesOf([["epic", 117]]);
    renderHook(() => useReflowEpics({} as EngineClient, doc, measured));
    await Promise.resolve();
    await Promise.resolve();

    expect(patchMock).toHaveBeenCalledTimes(1);
    const ops = patchMock.mock.calls[0][0] as unknown as CanvasOp[];
    const epicOp = ops.find((o) => o.id === "epic") as { size?: { h?: number }; position?: { y?: number } };
    // The measured height replaces the over-reserved 150 -- no green empty band below the text.
    expect(epicOp.size?.h).toBe(117);
    // The top edge is preserved: new y = top(560-150=410) + new height(117) = 527.
    expect(epicOp.position?.y).toBe(410 + 117);
  });

  it("shrinks an over-reserved content card whose text renders shorter than reserved", async () => {
    // A Summary card reserved 193px but its prose wraps to ~146 -- the reverse of the grow case, and
    // the dark band is exactly the (193 - 146) dead space. Measured 146 qualifies, so it re-fits.
    const epic = element({
      id: "epic",
      render: "epic",
      meta: { recipe_key: "EP-4" },
      size: { w: 860, h: 72 },
      position: { x: 0, y: 560 },
    });
    const summary = element({
      id: "summary",
      meta: { summary: "1", recipe_key: "EP-4::summary" },
      size: { w: 860, h: 193 },
      position: { x: 0, y: 750 },
    });
    const doc = docWith({ epic, summary });
    const measured = contentSizesOf([["epic", 72], ["summary", 146]]);
    renderHook(() => useReflowEpics({} as EngineClient, doc, measured));
    await Promise.resolve();
    await Promise.resolve();

    expect(patchMock).toHaveBeenCalledTimes(1);
    const ops = patchMock.mock.calls[0][0] as unknown as CanvasOp[];
    const summaryOp = ops.find((o) => o.id === "summary") as { size?: { h?: number } };
    expect(summaryOp.size?.h).toBe(146);
  });

  it("ignores a box within MIN_DELTA of its reserved height (no meaningful re-fit)", async () => {
    const epic = element({
      id: "epic",
      render: "epic",
      meta: { recipe_key: "EP-4" },
      size: { w: 640, h: 150 },
      position: { x: 0, y: 560 },
    });
    const doc = docWith({ epic });
    const measured = contentSizesOf([["epic", 151]]); // within 2 of 150 -- no meaningful change
    renderHook(() => useReflowEpics({} as EngineClient, doc, measured));
    await Promise.resolve();
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("ignores a content card on a non-epics layer", async () => {
    const summary = element({
      id: "summary",
      layer: "pattern",
      meta: { summary: "1", recipe_key: "P-1::summary" },
      size: { w: 860, h: 200 },
    });
    const doc = docWith({ summary });
    const measured = contentSizesOf([["summary", 300]]);
    renderHook(() => useReflowEpics({} as EngineClient, doc, measured));
    await Promise.resolve();
    expect(patchMock).not.toHaveBeenCalled();
  });
});
