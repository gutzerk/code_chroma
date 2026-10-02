import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InspectorChangeReview } from "./InspectorChangeReview";
import { inspectorStore } from "./inspectorStore";
import type { ImpactBlockChange } from "../state/types";

function change(overrides: Partial<ImpactBlockChange> = {}): ImpactBlockChange {
  return {
    block: "system/engine/graph",
    node_id: "c1-sub::system/engine/graph",
    name: "Graph model",
    path: "src/graph",
    status: "modified",
    files: [],
    change_count: 1,
    before: "Clustered directories by code references.",
    after: "One node per real directory.",
    explanation: "The reference grouping merged unrelated folders.",
    pr_comments: [],
    ...overrides,
  };
}

afterEach(() => {
  inspectorStore.reset();
});

describe("InspectorChangeReview", () => {
  it("renders the review's before, after and why sections", () => {
    render(<InspectorChangeReview change={change()} />);

    expect(screen.getByText("Clustered directories by code references.")).toBeInTheDocument();
    expect(screen.getByText("One node per real directory.")).toBeInTheDocument();
    expect(screen.getByText("The reference grouping merged unrelated folders.")).toBeInTheDocument();
  });

  it("says so plainly when the block has changes but no review prose yet", () => {
    render(<InspectorChangeReview change={change({ before: "", after: "", explanation: "" })} />);

    expect(screen.getByTestId("inspector-change-review-unreviewed")).toBeInTheDocument();
  });

  it("lists the changed files the badge is based on", () => {
    const files = [{ path: "src/graph/builder.py", status: "modified" as const }];

    render(<InspectorChangeReview change={change({ files })} />);

    expect(screen.getByText("src/graph/builder.py")).toBeInTheDocument();
  });

  it("pushes a clicked file onto the inspector's drill stack instead of an inline diff", () => {
    const files = [{ path: "src/graph/builder.py", status: "modified" as const }];

    render(<InspectorChangeReview change={change({ files })} />);
    fireEvent.click(screen.getByTestId("impact-change-file"));

    expect(screen.queryByTestId("diff-view")).not.toBeInTheDocument();
    expect(inspectorStore.getStack()).toEqual([
      { id: "component::src/graph/builder.py", name: "builder.py" },
    ]);
  });

  it("keeps the review on the stack so a file click can be backed out of", () => {
    const files = [{ path: "src/graph/builder.py", status: "modified" as const }];
    inspectorStore.open("c1-sub::system/engine/graph", "Graph model");

    render(<InspectorChangeReview change={change({ files })} />);
    fireEvent.click(screen.getByTestId("impact-change-file"));

    expect(inspectorStore.getStack()).toEqual([
      { id: "c1-sub::system/engine/graph", name: "Graph model" },
      { id: "component::src/graph/builder.py", name: "builder.py" },
    ]);
  });

  it("opens a file on Enter for keyboard users", () => {
    const files = [{ path: "src/graph/builder.py", status: "modified" as const }];

    render(<InspectorChangeReview change={change({ files })} />);
    fireEvent.keyDown(screen.getByTestId("impact-change-file"), { key: "Enter" });

    expect(inspectorStore.getStack()).toEqual([
      { id: "component::src/graph/builder.py", name: "builder.py" },
    ]);
  });

  it("carries its status on the wrapper so the accent styling can key on it", () => {
    render(<InspectorChangeReview change={change({ status: "removed" })} />);

    expect(screen.getByTestId("inspector-change-review")).toHaveAttribute("data-status", "removed");
  });

  it("lists PR review comments attributed to this block", () => {
    const pr_comments = [
      {
        author: "reviewer-jane",
        body: "Should this be configurable?",
        created_at: "2026-07-30T10:15:00Z",
        path: "src/graph/builder.py",
        line: 42,
      },
    ];

    render(<InspectorChangeReview change={change({ pr_comments })} />);

    expect(screen.getByTestId("inspector-change-review-comments")).toBeInTheDocument();
    expect(screen.getByText("Should this be configurable?")).toBeInTheDocument();
    expect(screen.getByText("reviewer-jane · line 42")).toBeInTheDocument();
  });

  it("shows no PR-comments section when the block has none", () => {
    render(<InspectorChangeReview change={change()} />);

    expect(screen.queryByTestId("inspector-change-review-comments")).not.toBeInTheDocument();
  });

  it("shows the resolved symbol and pushes it onto the inspector stack on click", () => {
    const pr_comments = [
      {
        author: "reviewer-jane",
        body: "Is this intentional?",
        created_at: "2026-07-30T10:15:00Z",
        path: "src/graph/builder.py",
        line: 176,
        symbol: "GraphBuilder._build_result",
        node_id: "src/graph/builder.py::function::GraphBuilder._build_result",
      },
    ];

    render(<InspectorChangeReview change={change({ pr_comments })} />);
    fireEvent.click(screen.getByTestId("impact-change-comment"));

    expect(screen.getByText("reviewer-jane · GraphBuilder._build_result() · line 176")).toBeInTheDocument();
    expect(inspectorStore.getStack()).toEqual([
      {
        id: "src/graph/builder.py::function::GraphBuilder._build_result",
        name: "GraphBuilder._build_result",
      },
    ]);
  });
});
