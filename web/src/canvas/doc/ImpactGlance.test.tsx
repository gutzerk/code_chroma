import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImpactGlance, beforeAfterLine } from "./ImpactGlance";
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

  it("renders nothing without a change", () => {
    render(<ImpactGlance change={undefined} doc={doc} elementId="b" />);

    expect(screen.queryByTestId("impact-glance")).not.toBeInTheDocument();
  });
});
