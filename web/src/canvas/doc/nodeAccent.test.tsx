import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { accentFor, ImpactStatusChip, OrderBadge, PlanKindChip } from "./nodeAccent";
import type { CanvasElement } from "../../state/types";

function element(render: CanvasElement["render"], meta: Record<string, unknown>): CanvasElement {
  return {
    id: "e1", render, layer: "default", label: "Box", description: "",
    node_id: null, position: { x: 0, y: 0 }, size: null, group_id: null,
    meta, created_by: "ai",
  };
}

describe("accentFor", () => {
  it("returns no accent for a plain node with no accent-bearing meta", () => {
    expect(accentFor(element("impact", {}))).toEqual({});
  });

  it("renders a recognized brand icon over a kind icon", () => {
    const accent = accentFor(element("c1", { icon: "stripe", kind: "database" }));

    expect(accent.icon).toBeTruthy();
  });

  it("renders a C1BlockIcon for a recognized kind with no brand icon", () => {
    const accent = accentFor(element("c1", { kind: "database" }));

    expect(accent.icon).toBeTruthy();
  });

  it("renders no icon for a kind C1BlockIcon does not recognize", () => {
    const accent = accentFor(element("pattern", { kind: "infra" }));

    expect(accent.icon).toBeUndefined();
  });

  // 036-shared-diagram-style-catalog Decision 7: patterns/impact/custom now gain icon-by-kind too,
  // the concrete proof the rules generalize beyond the one type each was originally built for.
  it("gives a custom node an icon when its kind happens to match a recognized C1BlockKind", () => {
    const accent = accentFor(element("custom", { kind: "queue" }));

    expect(accent.icon).toBeTruthy();
  });

  it("keeps patterns' exact kind class name so its existing CSS still applies", () => {
    const accent = accentFor(element("pattern", { kind: "infra" }));

    expect(accent.className).toBe("pattern-node-kind-infra");
  });

  it("namespaces a non-pattern kind class so it can never collide with patterns' own CSS", () => {
    const accent = accentFor(element("custom", { kind: "infra" }));

    expect(accent.className).toBe("custom-node-kind-infra");
  });

  it("gives an impact node its status class, unchanged from before", () => {
    const accent = accentFor(element("impact", { status: "modified" }));

    expect(accent.className).toBe("block-change--modified");
  });

  // A capability gain: status was impact-only before this feature.
  it("gives any node a status class now, not only impact", () => {
    const accent = accentFor(element("c1", { status: "added" }));

    expect(accent.className).toBe("block-change--added");
  });

  it("aliases impact's authored 'new' status onto the 'added' class, not a second token", () => {
    const accent = accentFor(element("impact", { status: "new" }));

    expect(accent.className).toBe("block-change--added");
  });

  it("gives a custom node its group class, unchanged from before", () => {
    const accent = accentFor(element("custom", { group: "Persistence" }));

    expect(accent.className).toMatch(/^custom-node-group-\d$/);
  });

  // A capability gain: group-based color was custom-only before this feature.
  it("gives any node a group class now, not only custom", () => {
    const accent = accentFor(element("c1", { group: "Persistence" }));

    expect(accent.className).toMatch(/^custom-node-group-\d$/);
  });

  it("combines multiple accent rules into one space-separated className", () => {
    const accent = accentFor(element("custom", { kind: "flow", status: "modified" }));

    expect(accent.className).toBe("custom-node-kind-flow block-change--modified");
  });

  it("is a stable hash: the same group name always picks the same class", () => {
    const first = accentFor(element("custom", { group: "Storage" }));
    const second = accentFor(element("custom", { group: "Storage" }));

    expect(first.className).toBe(second.className);
  });

  // 055-diagram-feature-plan: a Planned block's dashed-border accent, driven by meta.plan_kind.
  it("gives a Planned block its plan-kind class", () => {
    const accent = accentFor(element("custom", { plan_kind: "add" }));

    expect(accent.className).toBe("plan-kind-add");
  });

  it("gives no plan-kind class for an unrecognized plan_kind value", () => {
    const accent = accentFor(element("custom", { plan_kind: "rename" }));

    expect(accent.className).toBeUndefined();
  });
});

// 054-diagram-flow-order: unlike accentFor's rules, this carries a value the reader needs to see.
describe("OrderBadge", () => {
  it("renders the authored order value", () => {
    render(<OrderBadge element={element("custom", { order: "2a" })} />);

    expect(screen.getByTestId("canvas-node-order-badge")).toHaveTextContent("2a");
  });

  it("renders nothing when order is absent", () => {
    render(<OrderBadge element={element("custom", {})} />);

    expect(screen.queryByTestId("canvas-node-order-badge")).not.toBeInTheDocument();
  });
});

// 055-diagram-feature-plan: the role reads as text, not color alone (per the prototype's verdict).
describe("PlanKindChip", () => {
  it("renders the plan_kind role as an uppercase label", () => {
    render(<PlanKindChip element={element("custom", { plan_kind: "modify" })} />);

    expect(screen.getByTestId("plan-kind-chip")).toHaveTextContent("MODIFY");
  });

  it("renders nothing when plan_kind is absent", () => {
    render(<PlanKindChip element={element("custom", {})} />);

    expect(screen.queryByTestId("plan-kind-chip")).not.toBeInTheDocument();
  });

  it("renders nothing for an unrecognized plan_kind value", () => {
    render(<PlanKindChip element={element("custom", { plan_kind: "rename" })} />);

    expect(screen.queryByTestId("plan-kind-chip")).not.toBeInTheDocument();
  });
});

// The ADD/MODIFY/DELETE labeled chip, driven by Impact's authored meta.status (type-impact.md).
describe("ImpactStatusChip", () => {
  it("renders ADD for a new-status impact box", () => {
    render(<ImpactStatusChip element={element("impact", { status: "new" })} />);

    expect(screen.getByTestId("impact-status-chip")).toHaveTextContent("ADD");
  });

  it("renders MODIFY for a modified-status impact box", () => {
    render(<ImpactStatusChip element={element("impact", { status: "modified" })} />);

    expect(screen.getByTestId("impact-status-chip")).toHaveTextContent("MODIFY");
  });

  it("renders DELETE for a deleted-status impact box", () => {
    render(<ImpactStatusChip element={element("impact", { status: "deleted" })} />);

    expect(screen.getByTestId("impact-status-chip")).toHaveTextContent("DELETE");
  });

  it("renders nothing for a context-status impact box", () => {
    render(<ImpactStatusChip element={element("impact", { status: "context" })} />);

    expect(screen.queryByTestId("impact-status-chip")).not.toBeInTheDocument();
  });

  it("renders nothing when status is absent", () => {
    render(<ImpactStatusChip element={element("impact", {})} />);

    expect(screen.queryByTestId("impact-status-chip")).not.toBeInTheDocument();
  });

  it("renders nothing for a non-impact render kind even with a valid status", () => {
    render(<ImpactStatusChip element={element("custom", { status: "new" })} />);

    expect(screen.queryByTestId("impact-status-chip")).not.toBeInTheDocument();
  });
});
