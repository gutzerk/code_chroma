import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImpactGlance } from "./ImpactGlance";
import { beforeAfterLine, callerCountsOf } from "./impactGlanceLogic";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type ImpactBlockChange } from "../../state/types";

const change = (before: string, after: string): ImpactBlockChange => ({
  block: "b", node_id: "n", name: "N", path: null, status: "modified", files: [],
  change_count: 1, before, after, explanation: "", pr_comments: [],
});
const doc: CanvasDoc = {
  ...EMPTY_CANVAS_DOC,
  edges: { e1: { id: "e1", from: "x", to: "b", label: "", kind: "", layer: "l" } },
};

describe("ImpactGlance", () => {
  it("joins before and after on one line", () => {
    expect(beforeAfterLine(change("sync call", "queued job"))).toBe("sync call → queued job");
  });

  it("shows the line and the caller count", () => {
    render(<ImpactGlance change={change("a", "b")} doc={doc} elementId="b" />);

    expect(screen.getByTestId("impact-glance")).toHaveTextContent("a → b");
    expect(screen.getByTestId("impact-glance-callers")).toHaveTextContent("1 caller");
  });

  it("counts distinct callers once per doc and skips self-edges", () => {
    const many: CanvasDoc = {
      ...EMPTY_CANVAS_DOC,
      edges: {
        e1: { id: "e1", from: "x", to: "b", label: "", kind: "", layer: "l" },
        e2: { id: "e2", from: "x", to: "b", label: "", kind: "", layer: "l" },
        e3: { id: "e3", from: "y", to: "b", label: "", kind: "", layer: "l" },
        e4: { id: "e4", from: "b", to: "b", label: "", kind: "", layer: "l" },
      },
    };

    const counts = callerCountsOf(many);

    expect(counts.get("b")).toBe(2);
    expect(callerCountsOf(many)).toBe(counts);
  });

  it("renders nothing without a change", () => {
    render(<ImpactGlance change={undefined} doc={doc} elementId="b" />);

    expect(screen.queryByTestId("impact-glance")).not.toBeInTheDocument();
  });
});
