import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RouteStepExtras } from "./RouteStepExtras";
import { routeStepOf } from "./routeStep";
import { inspectorStore } from "../inspectorStore";
import { routeExpandStore } from "./routeExpandStore";
import type { CanvasElement } from "../../state/types";

function element(overrides: Partial<CanvasElement> & { id: string }): CanvasElement {
  return {
    render: "c1", layer: "c1", label: "Auth service", description: "", node_id: null,
    position: { x: 100, y: 100 }, size: null, group_id: null, meta: {}, created_by: "ai",
    ...overrides,
  };
}

function renderExtras(el: CanvasElement) {
  return render(<RouteStepExtras element={el} step={routeStepOf(el)!} />);
}

describe("RouteStepExtras (026)", () => {
  const stepEl = element({
    id: "s1",
    render: "custom",
    layer: "custom/flow",
    label: "Diff against manifest",
    meta: {
      route_step: {
        id: "s1", order: 4, kind: "decide", node_ids: [],
        children: [{ id: "c1", label: "ComputeDelta()", node_id: "function::x", line: 184 }],
      },
    },
  });

  afterEach(() => routeExpandStore.reset());

  it("shows an N calls chip that expands and collapses the children list", () => {
    renderExtras(stepEl);

    expect(screen.getByTestId("route-step-chip").textContent).toContain("1 calls");
    expect(screen.queryByTestId("route-step-children")).toBeNull();
    fireEvent.click(screen.getByTestId("route-step-chip"));
    expect(screen.getByTestId("route-step-children").textContent).toContain(":184");
    fireEvent.click(screen.getByTestId("route-step-chip"));
    expect(screen.queryByTestId("route-step-children")).toBeNull();
  });

  it("opens the child's function in the inspector from the arrow", () => {
    const open = vi.spyOn(inspectorStore, "open");
    renderExtras(stepEl);
    fireEvent.click(screen.getByTestId("route-step-chip"));

    fireEvent.click(screen.getByTestId("route-step-child-open"));

    expect(open).toHaveBeenCalledWith("function::x", "ComputeDelta()", "s1");
  });
});

