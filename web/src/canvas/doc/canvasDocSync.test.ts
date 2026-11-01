import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { canvasDocStore } from "./canvasDocStore";
import { useLoadCanvasDoc } from "./canvasDocSync";
import { EMPTY_CANVAS_DOC, type CanvasDoc } from "../../state/types";
import type { EngineClient } from "../../engine-client/EngineClient";

vi.mock("./pileLayout", () => ({
  findUnplaced: (doc: CanvasDoc, _skip: unknown, placed: Set<string>) =>
    Object.keys(doc.elements).some((id) => !placed.has(id)) ? { c1: Object.keys(doc.elements) } : {},
  layoutUnplaced: vi.fn(async () => {}),
}));

const ELEMENT = {
  id: "a",
  render: "c1" as const,
  layer: "c1",
  label: "",
  description: "",
  node_id: null,
  position: { x: 0, y: 0 },
  size: null,
  group_id: null,
  meta: {},
  created_by: "ai" as const,
};

afterEach(() => canvasDocStore.reset());

describe("fetchAndApplyCanvasDoc after auto-layout", () => {
  it("applies the doc even when the layout pass changed nothing", async () => {
    const doc: CanvasDoc = { ...EMPTY_CANVAS_DOC, elements: { a: ELEMENT } };
    const client = {
      getCanvas: async () => doc,
      subscribeCanvas: () => () => {},
      subscribe: () => () => {},
    } as unknown as EngineClient;

    renderHook(() => useLoadCanvasDoc(client));

    await waitFor(() => expect(canvasDocStore.getDoc().elements.a).toBeDefined());
  });
});
