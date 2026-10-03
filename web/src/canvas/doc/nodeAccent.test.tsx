import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ImpactStatusChip, NodeMetaRow, NodeTopBand, NoCodeChip,
} from "./nodeAccent";
import { accentFor } from "./nodeAccentLogic";
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

  // "Band + meta row, ghost no-code": plan_kind no longer touches accentFor's border classes at
  // all -- it only ever drives NodeTopBand now (see that describe block below).
  // diagram_resolver.py's _stamp_no_code_reason: a resolver-computed reason a box has no node_id.
  it("gives a conceptual no-code box its solid-border ghost class", () => {
    const accent = accentFor(element("custom", { no_code_reason: "conceptual" }));

    expect(accent.className).toBe("no-code-conceptual");
  });

  it("gives an unresolved no-code box its own solid-border ghost class", () => {
    const accent = accentFor(element("custom", { no_code_reason: "unresolved" }));

    expect(accent.className).toBe("no-code-unresolved");
  });

  it("gives no no-code class for a planned box -- 'planned' isn't a recognized reason", () => {
    const accent = accentFor(element("custom", { plan_kind: "add", no_code_reason: "planned" }));

    expect(accent.className).toBeUndefined();
  });
});

// "Band + meta row, ghost no-code": the box's top band holds its plan role and step number --
// replacing the old floating top-right PlanKindChip pill and OrderBadge corner tag.
describe("NodeTopBand", () => {
  it("renders the step number alone when only meta.order is authored", () => {
    render(<NodeTopBand element={element("custom", { order: "2a" })} />);

    expect(screen.getByTestId("canvas-node-order-badge")).toHaveTextContent("2a");
    expect(screen.queryByTestId("canvas-node-top-band-plan")).not.toBeInTheDocument();
  });

  it("renders the plan role alone as an uppercase label when only meta.plan_kind is authored", () => {
    render(<NodeTopBand element={element("custom", { plan_kind: "modify" })} />);

    expect(screen.getByTestId("canvas-node-top-band-plan")).toHaveTextContent("MODIFY");
    expect(screen.queryByTestId("canvas-node-order-badge")).not.toBeInTheDocument();
  });

  it("renders both together when the box carries plan_kind and order", () => {
    render(<NodeTopBand element={element("custom", { plan_kind: "add", order: "1" })} />);

    expect(screen.getByTestId("canvas-node-top-band-plan")).toHaveTextContent("ADD");
    expect(screen.getByTestId("canvas-node-order-badge")).toHaveTextContent("1");
  });

  it("renders nothing when neither plan_kind nor order is authored", () => {
    render(<NodeTopBand element={element("custom", {})} />);

    expect(screen.queryByTestId("canvas-node-top-band")).not.toBeInTheDocument();
  });

  it("renders nothing for an unrecognized plan_kind value", () => {
    render(<NodeTopBand element={element("custom", { plan_kind: "rename" })} />);

    expect(screen.queryByTestId("canvas-node-top-band")).not.toBeInTheDocument();
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

    // Form (data/Форма для задачи): a mark prefixes the status — "~ MODIFY", not the bare label.
    expect(screen.getByTestId("impact-status-chip")).toHaveTextContent("~ MODIFY");
  });

  it("appends the real change count as '· N' when supplied", () => {
    render(<ImpactStatusChip element={element("impact", { status: "modified" })} count={17} />);

    expect(screen.getByTestId("impact-status-chip")).toHaveTextContent("~ MODIFY · 17");
  });

  it("renders DELETE for a deleted-status impact box", () => {
    render(<ImpactStatusChip element={element("impact", { status: "deleted" })} />);

    expect(screen.getByTestId("impact-status-chip")).toHaveTextContent("− DELETE");
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

// meta.no_code_reason (diagram_resolver.py's _stamp_no_code_reason) as its own labeled chip.
describe("NoCodeChip", () => {
  it("renders CONCEPTUAL as an outlined meta-row chip, not the impact chip's filled shape", () => {
    render(<NoCodeChip element={element("custom", { no_code_reason: "conceptual" })} />);

    expect(screen.getByTestId("no-code-chip")).toHaveTextContent("CONCEPTUAL");
    expect(screen.getByTestId("no-code-chip")).toHaveClass("node-meta-chip", "node-meta-chip--no-code-conceptual");
  });

  it("renders UNRESOLVED as a meta-row chip with its own color class", () => {
    render(<NoCodeChip element={element("custom", { no_code_reason: "unresolved" })} />);

    expect(screen.getByTestId("no-code-chip")).toHaveTextContent("UNRESOLVED");
    expect(screen.getByTestId("no-code-chip")).toHaveClass("node-meta-chip", "node-meta-chip--no-code-unresolved");
  });

  it("renders nothing for a planned box -- 'planned' isn't a recognized reason", () => {
    render(<NoCodeChip element={element("custom", { no_code_reason: "planned" })} />);

    expect(screen.queryByTestId("no-code-chip")).not.toBeInTheDocument();
  });

  it("renders nothing when no_code_reason is absent", () => {
    render(<NoCodeChip element={element("custom", {})} />);

    expect(screen.queryByTestId("no-code-chip")).not.toBeInTheDocument();
  });
});

// The meta row has room for both chips side by side -- unlike the old floating layout, an Impact box
// with both an authored status and a no_code_reason no longer has to suppress one for the other.
describe("NodeMetaRow", () => {
  it("renders both the impact status chip and the no-code chip together", () => {
    render(<NodeMetaRow element={element("impact", { status: "new", no_code_reason: "conceptual" })} />);

    expect(screen.getByTestId("impact-status-chip")).toHaveTextContent("ADD");
    expect(screen.getByTestId("no-code-chip")).toHaveTextContent("CONCEPTUAL");
  });

  it("renders nothing when the box carries neither an impact status nor a no-code reason", () => {
    render(<NodeMetaRow element={element("impact", {})} />);

    expect(screen.queryByTestId("canvas-node-meta-row")).not.toBeInTheDocument();
  });

  it("renders the epic brief's authored meta tags as outlined chips", () => {
    render(
      <NodeMetaRow
        element={element("epic", {
          status: "Planned", priority: "Medium", group: "settings", depends_on: "EP-1",
        })}
      />,
    );

    const row = screen.getByTestId("canvas-node-meta-row");
    expect(row).toHaveTextContent("Planned");
    expect(row).toHaveTextContent("Medium");
    expect(row).toHaveTextContent("settings");
    expect(row).toHaveTextContent("depends_on → EP-1");
  });

  it("renders no meta row for an epic brief without authored tags", () => {
    render(<NodeMetaRow element={element("epic", {})} />);

    expect(screen.queryByTestId("canvas-node-meta-row")).not.toBeInTheDocument();
  });
});
