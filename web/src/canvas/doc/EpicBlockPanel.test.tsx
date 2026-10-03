import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { CanvasElement } from "../../state/types";
import { EpicBlockContent } from "./EpicBlockPanel";

function el(over: Partial<CanvasElement>): CanvasElement {
  return {
    id: "id",
    render: "task",
    layer: "epics/EP-4",
    label: "T001",
    description: "A task",
    node_id: null,
    position: { x: 0, y: 0 },
    size: null,
    group_id: null,
    meta: {},
    created_by: "ai",
    ...over,
  } as CanvasElement;
}

describe("EpicBlockContent", () => {
  it("shows only the linked source for a task, not kind or description", async () => {
    const client = {
      getSourceFragment: vi
        .fn()
        .mockResolvedValue({ path: "t.md", content: "- [ ] T001 Confirm", language: "markdown" }),
    } as unknown as EngineClient;
    render(
      <EpicBlockContent
        element={el({
          label: "T001 · Confirm app runs",
          meta: {
            phase: "1",
            source_ref: "specs/001-canvas-customization/tasks.md",
            line_start: 31,
            line_end: 31,
          },
        })}
        doc={{ elements: {} }}
        client={client}
      />,
    );

    expect(await screen.findByTestId("epic-block-panel-source")).toHaveTextContent("T001 Confirm");
    expect(screen.queryByText("Task · phase 1")).not.toBeInTheDocument();
    expect(screen.queryByText("A task")).not.toBeInTheDocument();
  });

  it("shows a phase header's tasks as children", () => {
    const phase = el({
      id: "phase",
      render: "spec",
      label: "Phase 1 · Setup",
      description: "Setup phase",
      meta: { recipe_key: "EP-4::phase-1" },
    });
    const task = el({
      id: "task",
      render: "task",
      label: "T001 · Confirm",
      meta: { recipe_key: "EP-4::phase-1::T001" },
    });
    render(<EpicBlockContent element={phase} doc={{ elements: { phase, task } }} />);

    expect(screen.getByText("Phase / spec")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText(/T001 · Confirm/)).toBeInTheDocument();
  });

  it("renders a linked file slice when the element carries a source_ref", async () => {
    const client = {
      getSourceFragment: vi.fn().mockResolvedValue({
        path: "specs/001-canvas-customization/tasks.md",
        content: "- [ ] T001 Confirm\n- [ ] T002 Create",
        language: "markdown",
      }),
    } as unknown as EngineClient;
    render(
      <EpicBlockContent
        element={el({
          label: "T001 · Confirm",
          meta: {
            source_ref: "specs/001-canvas-customization/tasks.md",
            line_start: 31,
            line_end: 31,
          },
        })}
        doc={{ elements: {} }}
        client={client}
      />,
    );

    expect(await screen.findByTestId("epic-block-panel-source")).toBeInTheDocument();
    expect(screen.getByTestId("epic-block-panel-source")).toHaveTextContent("T001 Confirm");
    expect(client.getSourceFragment).toHaveBeenCalledWith(
      "specs/001-canvas-customization/tasks.md",
      { start: 31, end: 31 },
    );
  });
});
