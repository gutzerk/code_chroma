import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { FocusPanel } from "./FocusPanel";
import { focusStore } from "./focusStore";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type CanvasElement } from "../../state/types";

const element = (id: string): CanvasElement => ({
  id, render: "c1", layer: "l", label: id, description: "", node_id: null,
  position: { x: 0, y: 0 }, size: null, group_id: null, meta: {}, created_by: "ai",
});
const edge = { id: "e1", from: "a", to: "b", label: "", kind: "", layer: "l" };
const doc: CanvasDoc = {
  ...EMPTY_CANVAS_DOC,
  elements: { a: element("a"), b: element("b") },
  edges: { e1: edge },
};

describe("FocusPanel", () => {
  beforeEach(() => focusStore.clear());

  it("clears the focus when the focused block leaves the doc", () => {
    focusStore.toggle(doc, "b");
    const { rerender } = render(<FocusPanel doc={doc} />);
    expect(screen.getByTestId("canvas-focus-panel")).toBeInTheDocument();

    rerender(<FocusPanel doc={{ ...doc, elements: { a: element("a") } }} />);

    expect(focusStore.current()).toBeNull();
  });

  it("mounts inside .canvas-area when there is one, so it can follow the left panel's CSS variables", () => {
    focusStore.toggle(doc, "b");
    const area = document.body.appendChild(document.createElement("div"));
    area.className = "canvas-area";

    render(<FocusPanel doc={doc} />);

    expect(area).toContainElement(screen.getByTestId("canvas-focus-panel"));
    area.remove();
  });

  it("clears the focus on Escape", () => {
    focusStore.toggle(doc, "b");
    render(<FocusPanel doc={doc} />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(focusStore.current()).toBeNull();
  });

  it("lists arrows, labels and counts, and toggles the direction back to both", () => {
    const labelled = { ...doc, edges: { e1: { ...edge, label: "BuildClusters" }, e2: { ...edge, id: "e2", from: "b", to: "a", kind: "spawns" } } };
    focusStore.toggle(labelled, "b");
    render(<FocusPanel doc={labelled} />);

    act(() => screen.getByRole("button", { name: "Downstream" }).click());
    expect(focusStore.current()?.direction).toBe("downstream");
    act(() => screen.getByRole("button", { name: "Downstream" }).click());

    expect(focusStore.current()?.direction).toBe("both");
    expect(screen.getByText("CALLED BY · 1")).toBeInTheDocument();
    expect(screen.getByTestId("focus-called-by")).toHaveTextContent("← a (BuildClusters)");
    expect(screen.getByTestId("focus-uses")).toHaveTextContent("⇢ a (spawns)");
  });
});
