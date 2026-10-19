import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ArrangeControls } from "./ArrangeControls";
import { diagramSelectionStore } from "./diagramSelectionStore";
import { shellStore } from "./shellStore";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { canvasDocStore } from "../canvas/doc/canvasDocStore";
import { clearArrange } from "../canvas/doc/arrangeController";
import { CANVAS_STUB } from "../engine-client/stubEngineClient";
import type { EngineClient } from "../engine-client/EngineClient";
import { EMPTY_CANVAS_DOC, type CanvasElement } from "../state/types";

const client = {
  ...CANVAS_STUB,
  patchCanvas: async () => ({ ok: true }),
  getCanvas: async () => canvasDocStore.getDoc(),
} as unknown as EngineClient;

function el(id: string, layer: string, x: number): CanvasElement {
  return {
    id, render: "custom", layer, label: id, description: "", node_id: null,
    position: { x, y: 0 }, size: null, group_id: null, meta: {}, created_by: "ai",
  };
}

function renderControls(fit = vi.fn()) {
  render(
    <EngineClientProvider repoId="default" client={client}>
      <ArrangeControls fitToBounds={fit} />
    </EngineClientProvider>,
  );
  return fit;
}

afterEach(() => {
  clearArrange();
  diagramSelectionStore.reset();
  canvasDocStore.reset();
  shellStore.reset();
});

describe("ArrangeControls", () => {
  it("disables the buttons with nothing selected", () => {
    renderControls();

    expect(screen.getByText("ARRANGE SELECTED · 0")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Stack" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("arranges on click and marks the active mode pressed", () => {
    canvasDocStore.setDoc({ ...EMPTY_CANVAS_DOC, elements: { a: el("a", "A", 0), b: el("b", "B", 900) } });
    act(() => {
      diagramSelectionStore.toggle("A");
      diagramSelectionStore.toggle("B");
    });
    const fit = renderControls();

    fireEvent.click(screen.getByRole("button", { name: "Grid" }));

    expect(screen.getByText("ARRANGE SELECTED · 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Stack" }).getAttribute("aria-pressed")).toBe("false");
    expect(fit).toHaveBeenCalledOnce();
  });
});
