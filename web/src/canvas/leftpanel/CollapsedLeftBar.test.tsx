import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { canvasDocStore } from "../doc/canvasDocStore";
import { collapsedLayersStore } from "../doc/collapsedLayersStore";
import { layoutStore } from "../layout/layoutStore";
import type { EngineClient } from "../../engine-client/EngineClient";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { IMPACT_CHANGES_STUB } from "../../engine-client/stubEngineClient";
import type { CanvasElement } from "../../state/types";
import { CollapsedLeftBar } from "./CollapsedLeftBar";

function diagramElement(id: string, layer: string): CanvasElement {
  return {
    id,
    render: "c1",
    layer,
    label: id,
    description: "",
    node_id: null,
    position: { x: 0, y: 0 },
    size: null,
    group_id: null,
    meta: {},
    created_by: "ai",
  };
}

function renderBar() {
  return render(
    <EngineClientProvider repoId="main" client={IMPACT_CHANGES_STUB as unknown as EngineClient}>
      <CollapsedLeftBar />
    </EngineClientProvider>,
  );
}

beforeEach(() => {
  canvasDocStore.reset();
  collapsedLayersStore.reset();
  layoutStore.reset();
  canvasDocStore.setDoc({
    ...canvasDocStore.getDoc(),
    elements: { c1a: diagramElement("c1a", "c1") },
  });
});

afterEach(cleanup);

describe("CollapsedLeftBar", () => {
  it("opens the diagrams tab from the chevron", () => {
    layoutStore.closeLeft();
    renderBar();

    fireEvent.click(screen.getByRole("button", { name: "Expand diagrams panel" }));

    expect(layoutStore.getState()).toMatchObject({ leftOpen: true, leftTab: "diagrams" });
  });

  it("opens the files tab from the folder button", () => {
    layoutStore.closeLeft();
    renderBar();

    fireEvent.click(screen.getByRole("button", { name: "Open Files" }));

    expect(layoutStore.getState()).toMatchObject({ leftOpen: true, leftTab: "files" });
  });

  it("toggles a diagram's visibility and its dashed swatch", () => {
    renderBar();
    const hide = screen.getByRole("button", { name: "Hide C1" });
    expect(hide).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(hide);

    const show = screen.getByRole("button", { name: "Show C1" });
    expect(show).toHaveAttribute("aria-pressed", "false");
    expect(show.firstElementChild).toHaveClass("collapsed-left-bar__swatch--hidden");
    expect(collapsedLayersStore.isCollapsed("c1")).toBe(true);
  });

  it("restores the diagram on a second click", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Hide C1" }));

    fireEvent.click(screen.getByRole("button", { name: "Show C1" }));

    expect(collapsedLayersStore.isCollapsed("c1")).toBe(false);
    expect(screen.getByRole("button", { name: "Hide C1" })).toHaveTextContent("");
  });
});
