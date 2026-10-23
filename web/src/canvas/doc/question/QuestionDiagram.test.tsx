import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type CanvasElement } from "../../../state/types";
import { diagramSubgraph, QuestionDiagram } from "./QuestionDiagram";
import { OPTIONS } from "./fixtures";

function el(id: string, extra: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id, render: "custom", layer: "d", label: `L-${id}`, description: "", node_id: null,
    position: { x: 100, y: 100 }, size: null, group_id: null, meta: {}, created_by: "ai", ...extra,
  };
}

const DOC: CanvasDoc = {
  ...EMPTY_CANVAS_DOC,
  elements: { "el-9": el("el-9"), kid: el("kid", { group_id: "el-9" }), far: el("far"), next: el("next") },
  edges: { e1: { id: "e1", from: "el-9", to: "next", label: "", kind: "", layer: "d" } },
};

describe("diagramSubgraph", () => {
  it("collects the root, its group members and elements reached along arrows", () => {
    const ids = diagramSubgraph(DOC, "el-9").map((e) => e.id).sort();

    expect(ids).toEqual(["el-9", "kid", "next"]);
  });

  it("is empty for a missing root", () => {
    expect(diagramSubgraph(DOC, "nope")).toEqual([]);
  });
});

describe("QuestionDiagram", () => {
  it("renders the selected option's diagram nodes read-only", () => {
    render(<QuestionDiagram doc={DOC} options={OPTIONS} selectedId="b" onSelect={() => {}} variant="pane" />);

    expect(screen.getAllByTestId("question-diagram-node")).toHaveLength(3);
  });

  it("shows the empty state for an option without a diagram and offers tabs only for options with one", () => {
    render(<QuestionDiagram doc={DOC} options={OPTIONS} selectedId="a" onSelect={() => {}} variant="pane" />);

    expect(screen.getByText("No diagram for this option")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("switches the option from a tab", () => {
    const onSelect = vi.fn();
    render(<QuestionDiagram doc={DOC} options={OPTIONS} selectedId="a" onSelect={onSelect} variant="pane" />);

    fireEvent.click(screen.getByRole("tab", { name: "2 · Services" }));

    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("opens full screen and closes it with Escape", () => {
    render(<QuestionDiagram doc={DOC} options={OPTIONS} selectedId="b" onSelect={() => {}} variant="box" />);

    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    const open = screen.getByTestId("question-diagram").className.includes("aq-diagram--full");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(open).toBe(true);
    expect(screen.getByTestId("question-diagram").className).not.toContain("aq-diagram--full");
  });
});
