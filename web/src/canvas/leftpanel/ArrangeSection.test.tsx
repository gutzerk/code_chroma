import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EngineClient } from "../../engine-client/EngineClient";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { IMPACT_CHANGES_STUB } from "../../engine-client/stubEngineClient";
import type { CanvasDoc, CanvasElement } from "../../state/types";
import { canvasDocStore } from "../doc/canvasDocStore";
import { layoutStore } from "../layout/layoutStore";
import { arrangeStore } from "./arrangeStore";
import { ArrangeSection } from "./ArrangeSection";
import { diagramSelectionStore } from "./diagramSelectionStore";

type Op = { id?: string; position?: { x: number; y: number } };

function element(id: string, layer: string, x: number, y: number): CanvasElement {
  return {
    id,
    render: "c1",
    layer,
    label: id,
    description: "",
    node_id: null,
    position: { x, y },
    size: { w: 100, h: 100 },
    group_id: null,
    meta: {},
    created_by: "ai",
  };
}

function setup() {
  const doc: CanvasDoc = {
    schema_version: 1,
    doc_id: "d",
    updated_at: "",
    elements: { a: element("a", "c1", 500, 500), b: element("b", "patterns", 900, 900) },
    edges: {},
  };
  const patchCanvas = vi.fn(async (batch: { ops: Op[] }) => {
    for (const op of batch.ops) {
      if (op.id && op.position) doc.elements[op.id] = { ...doc.elements[op.id], position: op.position };
    }
    return { ok: true };
  });
  canvasDocStore.setDoc(doc);
  diagramSelectionStore.toggle("c1");
  diagramSelectionStore.toggle("patterns");
  const client = {
    ...IMPACT_CHANGES_STUB,
    patchCanvas,
    getCanvas: async () => structuredClone(doc),
  } as unknown as EngineClient;
  render(
    <EngineClientProvider repoId="main" client={client}>
      <ArrangeSection getViewport={() => ({ width: 1440, height: 900 })} camera={{ x: 0, y: 0, scale: 1 }} />
    </EngineClientProvider>,
  );
  return patchCanvas;
}

afterEach(() => {
  cleanup();
  canvasDocStore.reset();
  diagramSelectionStore.reset();
  arrangeStore.reset();
  layoutStore.reset();
});

describe("ArrangeSection", () => {
  it("labels the selection count", () => {
    setup();

    expect(screen.getByText("Arrange selected · 2")).toBeInTheDocument();
  });

  it("writes new positions for the selected diagrams when a mode is clicked", async () => {
    const patchCanvas = setup();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    });

    const { a, b } = canvasDocStore.getDoc().elements;
    expect(screen.getByRole("button", { name: "Side by side" })).toHaveAttribute("aria-pressed", "true");
    expect(patchCanvas).toHaveBeenCalledOnce();
    expect(b.position.x - a.position.x).toBe(228);
  });

  it("restores the original positions when the active mode is clicked again", async () => {
    setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    });

    expect(canvasDocStore.getDoc().elements.a.position).toEqual({ x: 500, y: 500 });
    expect(screen.getByRole("button", { name: "Stack" })).toHaveAttribute("aria-pressed", "false");
  });
});
