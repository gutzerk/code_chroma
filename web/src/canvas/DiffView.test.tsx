import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiffView } from "./DiffView";
import type { HierarchyNodeRef, FunctionDiff } from "../state/types";

const NODE: HierarchyNodeRef = {
  node_id: "function::foo",
  name: "foo",
  level: "function",
  parent_id: "file::a.py",
  has_children: false,
  child_count: 0,
  language: "python",
};

const DIFF: FunctionDiff = {
  node_id: "function::foo",
  original_source: "def foo():\n    return 1",
  proposed_source: "def foo():\n    return 2",
};

describe("DiffView", () => {
  it("renders removed and added lines with their diff classes", () => {
    render(<DiffView node={NODE} diff={DIFF} />);

    const source = screen.getByTestId("diff-view-source");
    expect(source.querySelector(".diff-line-remove")?.textContent).toContain("return 1");
    expect(source.querySelector(".diff-line-add")?.textContent).toContain("return 2");
    expect(source.querySelector(".diff-line-context")?.textContent).toContain("def foo():");
  });

  it("shows the function name and params in the header", () => {
    render(<DiffView node={{ ...NODE, params: "() -> int" }} diff={DIFF} />);

    expect(screen.getByText("foo", { selector: ".block-code-view-name" })).toBeInTheDocument();
    expect(screen.getByText("() -> int")).toBeInTheDocument();
  });

  it("syntax-highlights diff lines for known languages", () => {
    render(<DiffView node={NODE} diff={DIFF} />);

    const source = screen.getByTestId("diff-view-source");
    expect(source.querySelector(".token-keyword")).toHaveTextContent("def");
  });

  it("renders a brand-new function's diff with an empty original side", () => {
    const newFunctionDiff: FunctionDiff = {
      node_id: "function::foo",
      original_source: "",
      proposed_source: "def foo():\n    return 1",
    };

    render(<DiffView node={NODE} diff={newFunctionDiff} />);

    const source = screen.getByTestId("diff-view-source");
    expect(source.querySelectorAll(".diff-line-remove").length).toBe(0);
    expect(source.querySelector(".diff-line-add")?.textContent).toContain("def foo():");
  });

  it("renders no Accept button when onAccept isn't provided", () => {
    render(<DiffView node={NODE} diff={DIFF} />);

    expect(screen.queryByTestId("diff-accept-button")).not.toBeInTheDocument();
  });

  it("calls onAccept with the diff's node_id when Accept is clicked", () => {
    const onAccept = vi.fn();
    render(<DiffView node={NODE} diff={DIFF} onAccept={onAccept} />);

    fireEvent.click(screen.getByTestId("diff-accept-button"));

    expect(onAccept).toHaveBeenCalledWith("function::foo");
  });

  it("disables the Accept button and swaps its label while accepting", () => {
    render(<DiffView node={NODE} diff={DIFF} onAccept={() => {}} isAccepting />);

    const button = screen.getByTestId("diff-accept-button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Committing…");
  });

  it("shows the accept error message when the last attempt failed", () => {
    render(<DiffView node={NODE} diff={DIFF} onAccept={() => {}} acceptError="could not apply" />);

    expect(screen.getByTestId("diff-accept-error")).toHaveTextContent("could not apply");
  });
});
