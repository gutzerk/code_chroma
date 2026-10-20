import { ARRANGE_GAP } from "./arrangeLayers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyArrange, clearArrange } from "./arrangeController";
import { canvasDocStore } from "./canvasDocStore";
import { reset as resetLayerCache, takeCachedPosition } from "./layerPositionCache";
import { shellStore } from "../../shell/shellStore";
import { undoStore } from "../../state/undoStore";
import { CANVAS_STUB } from "../../engine-client/stubEngineClient";
import type { EngineClient } from "../../engine-client/EngineClient";
import { EMPTY_CANVAS_DOC, type CanvasElement } from "../../state/types";

function el(id: string, layer: string, x: number, y: number): CanvasElement {
  return {
    id, render: "custom", layer, label: id, description: "", node_id: null,
    position: { x, y }, size: { w: 100, h: 50 }, group_id: null, meta: { recipe_key: id }, created_by: "ai",
  };
}

const patchCanvas = vi.fn(async () => ({ ok: true }));
const client = {
  ...CANVAS_STUB,
  patchCanvas,
  getCanvas: async () => canvasDocStore.getDoc(),
} as unknown as EngineClient;

const pos = (id: string) => canvasDocStore.getDoc().elements[id].position;

beforeEach(() => {
  const elements = [el("a", "A", 50, 25), el("b", "B", 1000, 1000), el("c", "C", 3000, 0)];
  canvasDocStore.setDoc({ ...EMPTY_CANVAS_DOC, elements: Object.fromEntries(elements.map((e) => [e.id, e])) });
});

afterEach(() => {
  clearArrange();
  canvasDocStore.reset();
  undoStore.reset();
  shellStore.reset();
  resetLayerCache();
  patchCanvas.mockClear();
});

describe("arrangeController", () => {
  it("arranges as one undo entry, sets the mode and fits the bounds", () => {
    const fitToBounds = vi.fn();

    applyArrange("side", { engineClient: client, selectedLayers: ["A", "B"], fitToBounds });

    expect(pos("b").x).toBe(50 + 50 + ARRANGE_GAP + 50);
    expect(shellStore.getState().arrangeMode).toBe("side");
    expect(patchCanvas).toHaveBeenCalledTimes(1);
    expect(undoStore.undo("canvas")).not.toBeNull();
    expect(undoStore.canUndo("canvas")).toBe(false);
    expect(fitToBounds).toHaveBeenCalledOnce();
  });

  it("keeps the original snapshot across a mode switch and restores it on a repeat click", () => {
    const opts = { engineClient: client, selectedLayers: ["A", "B"], fitToBounds: vi.fn() };

    applyArrange("side", opts);
    applyArrange("stack", opts);
    applyArrange("stack", opts);

    expect(pos("a")).toEqual({ x: 50, y: 25 });
    expect(pos("b")).toEqual({ x: 1000, y: 1000 });
    expect(shellStore.getState().arrangeMode).toBeNull();
  });

  it("seeds the layer position cache with pre-arrange positions", () => {
    applyArrange("side", { engineClient: client, selectedLayers: ["A", "B"], fitToBounds: vi.fn() });

    expect(takeCachedPosition("B", "b")).toEqual({ x: 1000, y: 1000 });
  });

  it("clearArrange drops the mode so the next click re-arranges", () => {
    const opts = { engineClient: client, selectedLayers: ["A", "B"], fitToBounds: vi.fn() };
    applyArrange("side", opts);

    clearArrange();
    applyArrange("side", opts);

    expect(shellStore.getState().arrangeMode).toBe("side");
  });
});
