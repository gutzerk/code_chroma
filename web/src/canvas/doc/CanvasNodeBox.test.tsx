import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CanvasNodeBox } from "./CanvasNodeBox";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { inspectorStore } from "../inspectorStore";
import { impactChangesSidecarStore, setChangesSnapshot } from "../../state/useSidecar";
import { selectionStore } from "../../state/selectionStore";
import { undoStore } from "../../state/undoStore";
import { canvasDocStore, useCanvasDoc } from "./canvasDocStore";
import { dragOffsetStore } from "./dragOffsetStore";
import { descriptionPopupStore } from "./descriptionPopupStore";
import { IMPACT_CHANGES_STUB, EPICS_STUB, EPIC_BRIEF_STUB, RESEARCH_STUB, PATTERNS_STUB, CANVAS_STUB } from "../../engine-client/stubEngineClient";
import type { EngineClient } from "../../engine-client/EngineClient";
import { EMPTY_CANVAS_DOC, type ImpactChanges, type CanvasElement } from "../../state/types";

function element(overrides: Partial<CanvasElement> & { id: string }): CanvasElement {
  return {
    render: "c1",
    layer: "c1",
    label: "Auth service",
    description: "",
    node_id: null,
    position: { x: 100, y: 100 },
    size: null,
    group_id: null,
    meta: {},
    created_by: "ai",
    ...overrides,
  };
}

const client = {
  ...IMPACT_CHANGES_STUB,
  ...EPICS_STUB,
  ...RESEARCH_STUB,
  ...EPIC_BRIEF_STUB,
  ...PATTERNS_STUB,
  ...CANVAS_STUB,
  // getCanvas normally overwrites canvasDocStore after a successful PATCH -- returning the store's
  // own current doc instead of CANVAS_STUB's EMPTY_CANVAS_DOC default means that refetch doesn't
  // clobber the optimistic position a group-drag test just asserted on.
  getCanvas: async () => canvasDocStore.getDoc(),
} as unknown as EngineClient;

function renderBox(el: CanvasElement) {
  return render(
    <EngineClientProvider repoId="default" client={client}>
      <CanvasNodeBox element={el} />
    </EngineClientProvider>,
  );
}

const CHANGES: ImpactChanges = {
  fingerprint: "f1",
  reviewed_fingerprint: "f1",
  has_review: true,
  stale: false,
  summary: "",
  blocks: [
    {
      block: "auth",
      node_id: "auth",
      name: "Auth service",
      path: "auth",
      status: "modified",
      files: [],
      change_count: 2,
      before: "",
      after: "",
      explanation: "",
      pr_comments: [],
    },
  ],
  ghosts: [],
  relationships: [],
  unassigned: [],
  changed_file_count: 1,
  general_pr_comments: [],
};

afterEach(() => {
  impactChangesSidecarStore.reset();
  inspectorStore.reset();
  descriptionPopupStore.reset();
});

describe("CanvasNodeBox — marquee selection key", () => {
  it("stamps data-select-id with its own canvas-doc element id, not its (possibly absent) node_id", () => {
    // Regression: a synthetic C1 System/Actor box has no node_id at all, and even a resolved box's
    // node_id is a different id space than selectionStore's own key -- CanvasViewport's marquee reads
    // this attribute specifically (see its own comment), so getting it wrong silently breaks
    // rubber-band select for every C1/Patterns/Impact/Epic box on the canvas.
    renderBox(element({ id: "e1", node_id: "fn:auth.py:issue" }));

    expect(screen.getByTestId("canvas-node-box")).toHaveAttribute("data-select-id", "e1");
  });

  it("still stamps data-select-id when node_id is null", () => {
    renderBox(element({ id: "e2", node_id: null }));

    expect(screen.getByTestId("canvas-node-box")).toHaveAttribute("data-select-id", "e2");
  });
});

describe("CanvasNodeBox — keyboard access", () => {
  it("opens the Inspector on Enter, not just on click", () => {
    renderBox(element({ id: "e1", node_id: "fn:auth.py:issue" }));

    fireEvent.keyDown(screen.getByTestId("canvas-node-box-header"), { key: "Enter" });

    expect(inspectorStore.getStack()).toEqual([
      { id: "fn:auth.py:issue", name: "Auth service", sourceId: "e1" },
    ]);
  });

  it("opens the Inspector on Space too", () => {
    renderBox(element({ id: "e1", node_id: "fn:auth.py:issue" }));

    fireEvent.keyDown(screen.getByTestId("canvas-node-box-header"), { key: " " });

    expect(inspectorStore.getStack()).toEqual([
      { id: "fn:auth.py:issue", name: "Auth service", sourceId: "e1" },
    ]);
  });

  it("ignores an unrelated key", () => {
    renderBox(element({ id: "e1", node_id: "fn:auth.py:issue" }));

    fireEvent.keyDown(screen.getByTestId("canvas-node-box-header"), { key: "Tab" });

    expect(inspectorStore.getStack()).toEqual([]);
  });
});

describe("CanvasNodeBox — clicking a block with no linked code", () => {
  it("still opens the Inspector, falling back to the element's own id, instead of doing nothing", () => {
    renderBox(element({ id: "e1", node_id: null }));

    fireEvent.click(screen.getByTestId("canvas-node-box-header"));

    // InspectorPanel's own useInspectorNode turns the resulting "no such node" answer into a clear
    // "no longer exists / diagram may be out of date" message with Retry -- the point here is only
    // that the panel opens at all, not that this id happens to resolve to real code.
    expect(inspectorStore.getStack()).toEqual([{ id: "e1", name: "Auth service", sourceId: "e1" }]);
  });
});

describe("CanvasNodeBox — re-clicking the box already open in the inspector", () => {
  it("closes the inspector instead of reopening the same page", () => {
    renderBox(element({ id: "e1", node_id: "fn:auth.py:issue" }));

    fireEvent.click(screen.getByTestId("canvas-node-box-header"));
    expect(inspectorStore.getStack()).toEqual([
      { id: "fn:auth.py:issue", name: "Auth service", sourceId: "e1" },
    ]);

    fireEvent.click(screen.getByTestId("canvas-node-box-header"));

    expect(inspectorStore.getStack()).toEqual([]);
  });

  it("still opens a different box's page instead of closing it", () => {
    render(
      <EngineClientProvider repoId="default" client={client}>
        <CanvasNodeBox element={element({ id: "e1", node_id: "fn:auth.py:issue" })} />
        <CanvasNodeBox element={element({ id: "e2", node_id: "fn:billing.py:charge", label: "Billing" })} />
      </EngineClientProvider>,
    );
    fireEvent.click(screen.getAllByTestId("canvas-node-box-header")[0]);

    fireEvent.click(screen.getAllByTestId("canvas-node-box-header")[1]);

    expect(inspectorStore.getStack()).toEqual([
      { id: "fn:billing.py:charge", name: "Billing", sourceId: "e2" },
    ]);
  });
});

// Regression: an activity/process diagram (054-diagram-flow-order) can draw one code entity as
// several boxes at different steps, all sharing one `node_id` -- clicking one used to highlight
// every box for that entity instead of just the one clicked (inspectorStore matched on node_id only).
// Placed alongside the other plain-click tests above, before any "group drag" test below runs a real
// drag: a just-finished drag arms a document-level capture listener that swallows the very next
// click wherever it lands (see useDragOffset.ts's suppressNextClick), which would otherwise eat this
// test's click if it ran later in the file.
describe("CanvasNodeBox — inspector highlight targets only the clicked box", () => {
  it("does not highlight a sibling box that shares the same node_id", () => {
    render(
      <EngineClientProvider repoId="default" client={client}>
        <>
          <CanvasNodeBox element={element({ id: "e1", node_id: "component::shared.go" })} />
          <CanvasNodeBox element={element({ id: "e2", node_id: "component::shared.go" })} />
        </>
      </EngineClientProvider>,
    );
    const boxes = screen.getAllByTestId("canvas-node-box");

    fireEvent.click(within(boxes[0]).getByTestId("canvas-node-box-header"));

    expect(boxes[0]).toHaveClass("block-inspector-target");
    expect(boxes[1]).not.toHaveClass("block-inspector-target");
  });
});

describe("CanvasNodeBox — copy button", () => {
  function stubClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    return writeText;
  }

  it("copies a real node's decoded path, not just the label, and doesn't open the Inspector", async () => {
    const writeText = stubClipboard();
    renderBox(element({ id: "e1", node_id: "dir::shadow-app/backend" }));

    fireEvent.click(screen.getByRole("button", { name: "Copy Auth service" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("shadow-app/backend"));
    expect(inspectorStore.getStack()).toEqual([]);
  });

  it("falls back to the element's own label for a synthesized box with no node_id", async () => {
    const writeText = stubClipboard();
    renderBox(element({ id: "e1", node_id: null }));

    fireEvent.click(screen.getByRole("button", { name: "Copy Auth service" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Auth service"));
  });

  it("falls back to the label for a coarse C1 block whose path is a bare top-level folder", async () => {
    const writeText = stubClipboard();
    renderBox(element({ id: "e1", label: "Control Plane", node_id: "dir::application" }));

    fireEvent.click(screen.getByRole("button", { name: "Copy Control Plane" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Control Plane"));
  });
});

describe("CanvasNodeBox — description popup", () => {
  it("opens the full description on '?' click without opening the Inspector", () => {
    renderBox(element({ id: "e1", label: "Auth service", description: "Handles login and tokens" }));

    fireEvent.click(screen.getByRole("button", { name: "Show full description for Auth service" }));

    expect(descriptionPopupStore.getEntry()).toEqual({
      title: "Auth service",
      description: "Handles login and tokens",
    });
    expect(inspectorStore.getStack()).toEqual([]);
  });

  it("renders no '?' button when the element has no description", () => {
    renderBox(element({ id: "e1", description: "" }));

    expect(
      screen.queryByRole("button", { name: "Show full description for Auth service" }),
    ).not.toBeInTheDocument();
  });
});

describe("CanvasNodeBox — title/description layout", () => {
  it("stacks the name and description in their own column instead of side by side (c1)", () => {
    // Regression: .block-header (c1's headerClass) is a row-direction flex container, so the
    // name-row and description used to render as two direct row items -- laying out side by side
    // (and visually overlapping/colliding) instead of stacked. Wrapping both in .block-title
    // (mirroring Block.tsx's own structure) fixes that.
    const { container } = renderBox(
      element({ id: "e1", label: "gateway-orchestration/internal", description: "Internal routing" }),
    );

    const wrap = container.querySelector(".block-title");
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector(".block-name-row")).not.toBeNull();
    expect(wrap).toHaveTextContent("Internal routing");
  });

  it("wraps a non-c1 kind's title/description too (its own headerClass is row-direction as well)", () => {
    // Regression: `.diagram-node-box-header` used to be column-direction but also carried the
    // literal class `block-header` for no real reason -- `justify-content: space-between` leaked in
    // from `.block-header`'s rule and, once the header was stretched to the box's full height,
    // pushed the copy/desc buttons all the way to the *bottom* of the block instead of beside the
    // title. Making every kind's header genuinely row-direction (with its own title-wrap column,
    // same shape as c1's `.block-title`) puts the buttons back on the right, in the block.
    const { container } = renderBox(
      element({ id: "e1", render: "pattern", label: "Auth", description: "Handles login" }),
    );

    const wrap = container.querySelector(".diagram-node-box-title-wrap");
    expect(wrap).not.toBeNull();
    expect(wrap).toHaveTextContent("Handles login");
    expect(screen.getByTestId("canvas-node-box-header").lastElementChild).toHaveClass(
      "canvas-node-box-buttons",
    );
  });
});

describe("CanvasNodeBox — box sizing", () => {
  it("pins width to element.size (not just a floor), so an isolated box can't stretch wider", () => {
    // Regression: `minWidth` alone let the box shrink-to-fit against `.canvas-content`'s own
    // unconstrained extent once nothing else pinned it nearby, growing wider until its
    // description fit on one line. A fixed `width` stops that.
    renderBox(element({ id: "e1", size: { w: 300, h: 80 } }));

    expect(screen.getByTestId("canvas-node-box")).toHaveStyle({ width: "300px" });
  });
});

describe("CanvasNodeBox — authored style", () => {
  it("applies an allow-listed style onto the box", () => {
    renderBox(element({ id: "e1", style: { background: "rgb(1, 2, 3)" } }));

    expect(screen.getByTestId("canvas-node-box")).toHaveStyle({ backgroundColor: "rgb(1, 2, 3)" });
  });

  it("drops a style key outside the allow-list", () => {
    renderBox(element({ id: "e1", style: { "z-index": "999" } as Record<string, string> }));

    expect(screen.getByTestId("canvas-node-box")).not.toHaveStyle({ zIndex: "999" });
  });
});

describe("CanvasNodeBox — change review chrome (Impact) and plan chrome (C1)", () => {
  it("shows the change badge and status accent for an Impact box the review touched", () => {
    setChangesSnapshot(CHANGES);

    renderBox(element({ id: "e1", render: "impact", meta: { recipe_key: "auth" } }));

    expect(screen.getByTestId("node-change-badge")).toHaveTextContent("~2");
    expect(screen.getByTestId("canvas-node-box").className).toContain("block-change--modified");
  });

  it("shows no badge for an Impact box the review doesn't touch", () => {
    setChangesSnapshot(CHANGES);

    renderBox(element({ id: "e1", render: "impact", meta: { recipe_key: "other" } }));

    expect(screen.queryByTestId("node-change-badge")).not.toBeInTheDocument();
  });

  it("never shows the change badge for a non-Impact render kind, even with a matching key", () => {
    setChangesSnapshot(CHANGES);

    renderBox(element({ id: "e1", render: "c1", meta: { recipe_key: "auth" } }));

    expect(screen.queryByTestId("node-change-badge")).not.toBeInTheDocument();
  });
});

// 054-diagram-flow-order: end-to-end through the real box, not just OrderBadge in isolation.
describe("CanvasNodeBox — order badge", () => {
  it("shows the order badge for a box with an authored order", () => {
    renderBox(element({ id: "e1", meta: { order: "3" } }));

    expect(screen.getByTestId("canvas-node-order-badge")).toHaveTextContent("3");
  });

  it("shows no order badge for a box without one", () => {
    renderBox(element({ id: "e1" }));

    expect(screen.queryByTestId("canvas-node-order-badge")).not.toBeInTheDocument();
  });
});

describe("CanvasNodeBox — Planned block (meta.plan_kind)", () => {
  it("shows an explicit chip naming the plan_kind role", () => {
    renderBox(element({ id: "e1", meta: { plan_kind: "add" } }));

    expect(screen.getByTestId("plan-kind-chip")).toHaveTextContent("ADD");
  });

  it("shows no chip when meta.plan_kind is absent", () => {
    renderBox(element({ id: "e1" }));

    expect(screen.queryByTestId("plan-kind-chip")).not.toBeInTheDocument();
  });

  it("applies a dashed-border accent class per plan_kind value", () => {
    renderBox(element({ id: "e1", render: "custom", meta: { plan_kind: "modify" } }));

    expect(screen.getByTestId("canvas-node-box").className).toContain("plan-kind-modify");
  });

  it("opens the description popup on click for an add/create Planned block, not the Inspector", () => {
    renderBox(
      element({
        id: "e1",
        node_id: null,
        label: "apply_coupon",
        description: "short",
        meta: { plan_kind: "add", details: "much longer explanation" },
      }),
    );

    fireEvent.click(screen.getByTestId("canvas-node-box-header"));

    expect(descriptionPopupStore.getEntry()).toEqual({
      title: "apply_coupon",
      description: "much longer explanation",
    });
    expect(inspectorStore.getStack()).toEqual([]);
  });

  it("falls back to description when meta.details is absent for an add/create Planned block", () => {
    renderBox(
      element({ id: "e1", node_id: null, description: "short", meta: { plan_kind: "create" } }),
    );

    fireEvent.click(screen.getByTestId("canvas-node-box-header"));

    expect(descriptionPopupStore.getEntry()).toEqual({ title: "Auth service", description: "short" });
  });

  it("still opens the Inspector as usual for a modify/delete Planned block (real path)", () => {
    renderBox(
      element({ id: "e1", node_id: "fn:payments.py:charge", meta: { plan_kind: "modify" } }),
    );

    fireEvent.click(screen.getByTestId("canvas-node-box-header"));

    expect(inspectorStore.getStack()).toEqual([
      { id: "fn:payments.py:charge", name: "Auth service", sourceId: "e1" },
    ]);
    expect(descriptionPopupStore.getEntry()).toBeNull();
  });
});

// type-impact.md: the ADD/MODIFY/DELETE chip driven by an Impact box's authored meta.status.
describe("CanvasNodeBox — Impact status chip (meta.status)", () => {
  it("shows an explicit chip naming the status role", () => {
    renderBox(element({ id: "e1", render: "impact", meta: { status: "deleted" } }));

    expect(screen.getByTestId("impact-status-chip")).toHaveTextContent("DELETE");
  });

  it("shows no chip when meta.status is absent", () => {
    renderBox(element({ id: "e1", render: "impact" }));

    expect(screen.queryByTestId("impact-status-chip")).not.toBeInTheDocument();
  });

  it("shows no chip for a context-status box", () => {
    renderBox(element({ id: "e1", render: "impact", meta: { status: "context" } }));

    expect(screen.queryByTestId("impact-status-chip")).not.toBeInTheDocument();
  });
});

function setDoc(elements: CanvasElement[]) {
  canvasDocStore.setDoc({
    ...EMPTY_CANVAS_DOC,
    elements: Object.fromEntries(elements.map((el) => [el.id, el])),
  });
}

describe("CanvasNodeBox — nodeAccent", () => {
  it("renders a C1BlockIcon for a C1 box whose meta.kind is a recognized architectural kind", () => {
    const { container } = renderBox(element({ id: "e1", meta: { kind: "database" } }));

    expect(container.querySelector(".c1-block-icon-database")).toBeInTheDocument();
  });

  it("applies the block-change--deleted accent for an authored Impact meta.status", () => {
    renderBox(element({ id: "e1", render: "impact", meta: { status: "deleted" } }));

    expect(screen.getByTestId("canvas-node-box").className).toContain("block-change--deleted");
  });

  it("renders no icon and no accent class for a C1 box with no meta.kind at all", () => {
    const { container } = renderBox(element({ id: "e1", meta: {} }));

    expect(container.querySelector(".c1-block-icon")).not.toBeInTheDocument();
    expect(screen.getByTestId("canvas-node-box").className).not.toContain("undefined");
  });
});

describe("CanvasNodeBox — group drag", () => {
  afterEach(() => {
    selectionStore.reset();
    canvasDocStore.reset();
    dragOffsetStore.reset();
    undoStore.reset();
  });

  it("moves every selected box by the same delta, in one batched commit", () => {
    const a = element({ id: "a", label: "A", position: { x: 100, y: 100 } });
    const b = element({ id: "b", label: "B", position: { x: 400, y: 100 } });
    setDoc([a, b]);
    selectionStore.replace(["a", "b"]);
    render(
      <EngineClientProvider repoId="default" client={client}>
        <CanvasNodeBox element={a} />
        <CanvasNodeBox element={b} />
      </EngineClientProvider>,
    );
    const handleA = screen.getAllByTestId("canvas-node-box")[0];

    fireEvent.pointerDown(handleA, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 20 });
    // Mid-drag: the group's own preview already reached the OTHER (passive) box, not just the one
    // the pointer is on -- this is the exact mechanism a solo useDragOffset never had a reason to
    // provide, and the thing that was actually missing before this change.
    expect(dragOffsetStore.getAll()).toEqual({
      a: { x: 30, y: 20 },
      b: { x: 30, y: 20 },
    });

    fireEvent.pointerUp(document, { pointerId: 1, clientX: 30, clientY: 20 });

    expect(canvasDocStore.getDoc().elements.a.position).toEqual({ x: 130, y: 120 });
    expect(canvasDocStore.getDoc().elements.b.position).toEqual({ x: 430, y: 120 });
    // The live offset channel is cleared once the delta is folded into each box's real position --
    // otherwise a passive member would render twice-displaced on the very next drag.
    expect(dragOffsetStore.getAll()).toEqual({});
    // Miro-style: a completed group move deselects, matching the hierarchy's own useSelectionAwareDrag.
    expect(selectionStore.getSelectedIds()).toEqual([]);
  });

  it("records the pre-drag positions as one undoable 'canvas' commit", () => {
    const a = element({ id: "a", label: "A", position: { x: 100, y: 100 } });
    const b = element({ id: "b", label: "B", position: { x: 400, y: 100 } });
    setDoc([a, b]);
    selectionStore.replace(["a", "b"]);
    render(
      <EngineClientProvider repoId="default" client={client}>
        <CanvasNodeBox element={a} />
        <CanvasNodeBox element={b} />
      </EngineClientProvider>,
    );
    const handleA = screen.getAllByTestId("canvas-node-box")[0];

    fireEvent.pointerDown(handleA, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 20 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 30, clientY: 20 });

    expect(undoStore.canUndo("canvas")).toBe(true);
    expect(undoStore.undo("canvas")).toEqual({
      a: { x: 100, y: 100 },
      b: { x: 400, y: 100 },
    });
  });

  it("clears every member's live offset if the drag handle unmounts mid-drag, instead of leaving them stuck", () => {
    const a = element({ id: "a", label: "A", position: { x: 100, y: 100 } });
    const b = element({ id: "b", label: "B", position: { x: 400, y: 100 } });
    setDoc([a, b]);
    selectionStore.replace(["a", "b"]);
    const { unmount } = render(
      <EngineClientProvider repoId="default" client={client}>
        <CanvasNodeBox element={a} />
        <CanvasNodeBox element={b} />
      </EngineClientProvider>,
    );
    const handleA = screen.getAllByTestId("canvas-node-box")[0];

    fireEvent.pointerDown(handleA, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 20 });
    expect(dragOffsetStore.getAll()).toEqual({ a: { x: 30, y: 20 }, b: { x: 30, y: 20 } });

    // Box A (the drag handle) gets deleted by another window/agent mid-gesture -- no pointerup ever
    // reaches this drag, so onGroupCommit never runs; box B's own leftover offset must still clear.
    unmount();

    expect(dragOffsetStore.getAll()).toEqual({});
  });

  /** Renders both boxes off a LIVE canvasDocStore subscription, the same way CanvasDocView really
   * does -- a test that instead passes a fixed `element` object straight into `<CanvasNodeBox>`
   * never sees `element.position` advance after a commit, which would silently hide a real
   * render-time position bug behind a stale prop instead of exercising it. */
  function LiveBoxes({ ids }: { ids: string[] }) {
    const doc = useCanvasDoc();
    return (
      <>
        {ids.map((id) => (doc.elements[id] ? <CanvasNodeBox key={id} element={doc.elements[id]} /> : null))}
      </>
    );
  }

  function renderLiveBoxes(ids: string[]) {
    return render(
      <EngineClientProvider repoId="default" client={client}>
        <LiveBoxes ids={ids} />
      </EngineClientProvider>,
    );
  }

  it("re-selecting a box that previously led a group drag renders it at its real position", () => {
    // Regression test: `onGroupCommit` never resets the group hook's own internal offset (unlike
    // solo's explicit `resetOffset()`), so a box that once led a group drag keeps that nonzero
    // offset sitting in its own hook state forever after. It stays invisible while deselected
    // (deselection routes rendering through `solo`, whose own offset genuinely never moves) -- but
    // the instant the box is selected again as part of a 2+ group, rendering switches back to the
    // stale `group` hook, and its leftover offset used to silently add on top of the box's real,
    // already-updated position -- with no second drag needed to see it.
    const a = element({ id: "a", label: "A", position: { x: 100, y: 100 } });
    const b = element({ id: "b", label: "B", position: { x: 400, y: 100 } });
    setDoc([a, b]);
    selectionStore.replace(["a", "b"]);
    renderLiveBoxes(["a", "b"]);
    const handleA = screen.getAllByTestId("canvas-node-box")[0];

    fireEvent.pointerDown(handleA, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 20 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 30, clientY: 20 });

    expect(canvasDocStore.getDoc().elements.a.position).toEqual({ x: 130, y: 120 });

    // Re-select both boxes WITHOUT starting a new drag at all -- this alone flips box A's own
    // `isGroupDrag` back to true. Wrapped in act() so the resulting re-render is committed before
    // the DOM is read below.
    act(() => {
      selectionStore.replace(["a", "b"]);
    });

    const boxA = document.querySelector('[data-select-id="a"]') as HTMLElement;
    // Real (committed) position is (130, 120), width 220 -> left = 130 - 110 = 20, top = 120 - 36 =
    // 84. A leftover 30/20 offset would instead show left = 50, top = 104 -- the exact "jumps to a
    // different position" the moment the box is reselected, no drag involved.
    expect(boxA.style.left).toBe("20px");
    expect(boxA.style.top).toBe("84px");
  });

  it("a box that led an earlier drag renders correctly after being swept passively into a later one", () => {
    // Deeper variant of the same regression: box A's stale internal offset from drag #1 survives
    // even through a second, unrelated group commit (drag #2, led by B) that clears every
    // participant's *dragOffsetStore* entry (A's included) without touching A's own internal hook
    // state at all -- so the bug can resurface without A ever being a drag handle again.
    const a = element({ id: "a", label: "A", position: { x: 100, y: 100 } });
    const b = element({ id: "b", label: "B", position: { x: 400, y: 100 } });
    setDoc([a, b]);
    selectionStore.replace(["a", "b"]);
    renderLiveBoxes(["a", "b"]);
    const handleA = screen.getAllByTestId("canvas-node-box")[0];

    fireEvent.pointerDown(handleA, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 20 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 30, clientY: 20 });

    act(() => {
      selectionStore.replace(["a", "b"]);
    });
    const handleB = screen.getAllByTestId("canvas-node-box")[1];
    fireEvent.pointerDown(handleB, { button: 0, pointerId: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(document, { pointerId: 2, clientX: 10, clientY: 10 });

    // Both drags move every selected box by their own delta: a ends at (100+30+10, 100+20+10).
    expect(canvasDocStore.getDoc().elements.a.position).toEqual({ x: 140, y: 130 });

    // Re-select once more, with no further drag -- exposes A's own still-stale offset from drag #1.
    act(() => {
      selectionStore.replace(["a", "b"]);
    });

    const boxA = document.querySelector('[data-select-id="a"]') as HTMLElement;
    expect(boxA.style.left).toBe(`${140 - 110}px`);
    expect(boxA.style.top).toBe(`${130 - 36}px`);
  });

  it("a lone selected box (no group) still drags solo, unaffected by this change", () => {
    const a = element({ id: "a", label: "A", position: { x: 100, y: 100 } });
    setDoc([a]);
    selectionStore.replace(["a"]);
    render(
      <EngineClientProvider repoId="default" client={client}>
        <CanvasNodeBox element={a} />
      </EngineClientProvider>,
    );
    const box = screen.getByTestId("canvas-node-box");

    fireEvent.pointerDown(box, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 20 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 30, clientY: 20 });

    expect(canvasDocStore.getDoc().elements.a.position).toEqual({ x: 130, y: 120 });
  });
});
