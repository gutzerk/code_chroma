import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type CanvasElement } from "../../../state/types";
import { CanvasDiagramFocusContext } from "../../CanvasFocusContext";
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

function withBody(width: number, height: number) {
  const w = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  const h = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(height);
  return () => {
    w.mockRestore();
    h.mockRestore();
  };
}

function stageTransform(): { x: number; y: number; scale: number } {
  const style = (screen.getByTestId("question-diagram-stage") as HTMLElement).style.transform;
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(style);
  if (!m) throw new Error(`unexpected transform: ${style}`);
  return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
}

const RICH: CanvasDoc = {
  ...EMPTY_CANVAS_DOC,
  elements: {
    "el-9": el("el-9", { render: "group", label: "Services", size: { w: 700, h: 300 }, position: { x: 400, y: 150 } }),
    a: el("a", { label: "Gateway", description: "Routes all traffic", group_id: "el-9", position: { x: 150, y: 150 }, size: { w: 200, h: 80 } }),
    b: el("b", { label: "Orders", description: "Owns checkout", group_id: "el-9", position: { x: 650, y: 150 }, size: { w: 200, h: 80 }, meta: { status: "new" } }),
  },
  edges: { e1: { id: "e1", from: "a", to: "b", label: "calls", kind: "", layer: "d" } },
};

describe("QuestionDiagram readability", () => {
  it("draws edge labels, arrowheads and node descriptions", () => {
    render(<QuestionDiagram doc={RICH} options={OPTIONS} selectedId="b" onSelect={() => {}} variant="pane" />);

    expect(screen.getByText("calls")).toBeInTheDocument();
    expect(screen.getByText("Routes all traffic")).toHaveAttribute("title", "Routes all traffic");
    expect(document.querySelector("marker")).not.toBeNull();
    expect(screen.getByTestId("question-diagram-frame")).toBeInTheDocument();
    expect(screen.getAllByTestId("question-diagram-node")).toHaveLength(2);
  });

  it("never fits below the readable minimum scale for a large diagram", () => {
    const restore = withBody(800, 600);
    const big: CanvasDoc = {
      ...EMPTY_CANVAS_DOC,
      elements: { "el-9": el("el-9", { position: { x: 0, y: 0 } }), far: el("far", { group_id: "el-9", position: { x: 6000, y: 4000 } }) },
      edges: {},
    };

    render(<QuestionDiagram doc={big} options={OPTIONS} selectedId="b" onSelect={() => {}} variant="pane" />);
    const { scale } = stageTransform();
    restore();

    expect(scale).toBeCloseTo(0.7);
  });

  it("scales a small diagram up to at most 1.5", () => {
    const restore = withBody(2000, 2000);

    render(<QuestionDiagram doc={RICH} options={OPTIONS} selectedId="b" onSelect={() => {}} variant="pane" />);
    const { scale } = stageTransform();
    restore();

    expect(scale).toBeCloseTo(1.5);
  });

  it("pans on drag past the threshold", () => {
    const restore = withBody(800, 600);
    render(<QuestionDiagram doc={RICH} options={OPTIONS} selectedId="b" onSelect={() => {}} variant="pane" />);
    const body = document.querySelector(".aq-diagram-body") as HTMLElement;
    const before = stageTransform();

    fireEvent.pointerDown(body, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(body, { clientX: 160, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(body, { pointerId: 1 });
    const after = stageTransform();
    restore();

    expect(after.x - before.x).toBe(60);
    expect(after.y - before.y).toBe(30);
  });

  it("zooms with the wheel", () => {
    const restore = withBody(800, 600);
    render(<QuestionDiagram doc={RICH} options={OPTIONS} selectedId="b" onSelect={() => {}} variant="pane" />);
    const body = document.querySelector(".aq-diagram-body") as HTMLElement;
    const before = stageTransform().scale;

    fireEvent.wheel(body, { deltaY: -200, clientX: 10, clientY: 10 });
    const after = stageTransform().scale;
    restore();

    expect(after).toBeGreaterThan(before);
  });

  it("renders full screen into document.body", () => {
    render(<QuestionDiagram doc={RICH} options={OPTIONS} selectedId="b" onSelect={() => {}} variant="box" />);

    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));

    expect(screen.getByTestId("question-diagram").parentElement).toBe(document.body);
  });

  it("opens the diagram's layer on the canvas from both variants", () => {
    const focus = vi.fn(() => true);
    const doc: CanvasDoc = { ...RICH, elements: { ...RICH.elements, "el-9": { ...RICH.elements["el-9"], layer: "decisions/q1" } } };
    const { unmount } = render(
      <CanvasDiagramFocusContext.Provider value={focus}>
        <QuestionDiagram doc={doc} options={OPTIONS} selectedId="b" onSelect={() => {}} variant="pane" />
      </CanvasDiagramFocusContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open on canvas" }));
    unmount();
    render(
      <CanvasDiagramFocusContext.Provider value={focus}>
        <QuestionDiagram doc={doc} options={OPTIONS} selectedId="b" onSelect={() => {}} variant="box" />
      </CanvasDiagramFocusContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open on canvas" }));

    expect(focus).toHaveBeenCalledTimes(2);
    expect(focus).toHaveBeenCalledWith("decisions/q1");
  });
});
