import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { compareLabelOf, ImpactChangeSummary, outsideSummaryOf } from "./ImpactChangeSummary";
import { impactChangesSidecarStore, setChangesSnapshot } from "../state/useSidecar";
import { inspectorStore } from "./inspectorStore";
import { canvasDocStore } from "./doc/canvasDocStore";
import * as availability from "../llm-settings/useGroupAvailability";
import type { CanvasElement, ImpactChanges, PrWorkspace } from "../state/types";

vi.mock("../llm-settings/useGroupAvailability", () => ({
  useGroupAvailability: vi.fn(),
  NO_PROVIDER_HINT: "no provider hint",
  guardedClick: (disabled: boolean, onClick: () => void) => () => {
    if (!disabled) onClick();
  },
  providerGate: (providerAvailable: boolean) => ({
    "aria-disabled": !providerAvailable,
    title: providerAvailable ? undefined : "no provider hint",
  }),
}));

const useGroupAvailability = vi.mocked(availability.useGroupAvailability);

function changes(overrides: Partial<ImpactChanges> = {}): ImpactChanges {
  return {
    fingerprint: "abc",
    reviewed_fingerprint: "abc",
    has_review: true,
    stale: false,
    summary: "",
    blocks: [],
    ghosts: [],
    relationships: [],
    unassigned: [],
    changed_file_count: 1,
    general_pr_comments: [],
    ...overrides,
  };
}

const review = { state: "idle" as const, rereview: () => {}, stop: () => {}, loading: false };

afterEach(() => {
  impactChangesSidecarStore.reset();
  inspectorStore.reset();
  canvasDocStore.reset();
  useGroupAvailability.mockReturnValue(true);
});

useGroupAvailability.mockReturnValue(true);

describe("ImpactChangeSummary", () => {
  it("shows a loading message instead of an empty-diff message while the first fetch is in flight", () => {
    render(<ImpactChangeSummary review={{ ...review, loading: true }} />);

    expect(screen.getByTestId("impact-change-summary-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("impact-change-summary-empty")).not.toBeInTheDocument();
  });

  it("shows a general PR comment with no path as plain text", () => {
    setChangesSnapshot(
      changes({
        general_pr_comments: [
          {
            author: "reviewer-jane",
            body: "LGTM overall.",
            created_at: "2026-07-30T10:15:00Z",
            path: null,
            line: null,
          },
        ],
      }),
    );

    render(<ImpactChangeSummary review={review} />);

    expect(screen.getByText("LGTM overall.")).toBeInTheDocument();
    expect(screen.getByText("reviewer-jane")).toBeInTheDocument();
  });

  it("shows the resolved symbol and opens it in the inspector on click", () => {
    setChangesSnapshot(
      changes({
        general_pr_comments: [
          {
            author: "reviewer-jane",
            body: "Should this override be logged?",
            created_at: "2026-07-30T10:15:00Z",
            path: "src/services/validation_service.py",
            line: 223,
            symbol: "ValidationService._effective_status",
            node_id: "src/services/validation_service.py::function::ValidationService._effective_status",
          },
        ],
      }),
    );

    render(<ImpactChangeSummary review={review} />);
    fireEvent.click(screen.getByTestId("impact-change-summary-comment"));

    expect(
      screen.getByText("reviewer-jane · ValidationService._effective_status() · line 223"),
    ).toBeInTheDocument();
    expect(inspectorStore.getStack()).toEqual([
      {
        id: "src/services/validation_service.py::function::ValidationService._effective_status",
        name: "ValidationService._effective_status",
      },
    ]);
  });

  it("falls back to path and line when the comment has no resolved symbol", () => {
    setChangesSnapshot(
      changes({
        general_pr_comments: [
          {
            author: "reviewer-jane",
            body: "Wrong file entirely.",
            created_at: "2026-07-30T10:15:00Z",
            path: "docs/readme.md",
            line: 4,
          },
        ],
      }),
    );

    render(<ImpactChangeSummary review={review} />);

    expect(screen.getByText("reviewer-jane · docs/readme.md:4")).toBeInTheDocument();
  });

  it("marks Re-review aria-disabled, but keyboard-reachable, when no provider CLI is available", () => {
    useGroupAvailability.mockReturnValue(false);

    render(<ImpactChangeSummary review={review} />);
    const button = screen.getByTestId("impact-change-rereview");

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
  });

  it("ignores a click on Re-review when no provider CLI is available", () => {
    useGroupAvailability.mockReturnValue(false);
    const rereview = vi.fn();
    render(<ImpactChangeSummary review={{ ...review, rereview }} />);

    fireEvent.click(screen.getByTestId("impact-change-rereview"));

    expect(rereview).not.toHaveBeenCalled();
  });
});

describe("impact strip helpers", () => {
  it("labels a PR workspace against its base and anything else against HEAD", () => {
    const pr = { id: "pr-76", number: 76, base_ref: "main" } as PrWorkspace;

    expect(compareLabelOf("pr-76", [pr])).toBe("PR #76 vs main");
    expect(compareLabelOf("main", [pr])).toBe("WORKING TREE vs HEAD");
  });

  it("folds outside files of one folder into a count and names a lone file", () => {
    const file = (path: string) => ({ path, status: "modified" as const });

    const line = outsideSummaryOf([file("docs/architecture/a.md"), file("docs/architecture/b.md"), file("web/package.json")]);

    expect(line).toBe("docs/architecture (2) · package.json");
  });

  it("puts the review card in the board's side column beside the legend", () => {
    const element: CanvasElement = { id: "a", render: "impact", layer: "impact", label: "a", description: "", node_id: null, position: { x: 100, y: 100 }, size: { w: 260, h: 96 }, group_id: null, meta: {}, created_by: "ai" };
    canvasDocStore.setDoc({ ...canvasDocStore.getDoc(), elements: { a: element } });
    setChangesSnapshot(changes());

    render(<ImpactChangeSummary review={review} />);

    const side = screen.getByTestId("impact-board-side");
    expect(side).toHaveClass("impact-board-anchor--side");
    expect(side).toContainElement(screen.getByTestId("impact-change-summary"));
  });
});
