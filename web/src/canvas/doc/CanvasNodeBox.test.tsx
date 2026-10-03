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
import { IMPACT_CHANGES_STUB, EPICS_STUB, EPIC_BRIEF_STUB, PATTERNS_STUB, CANVAS_STUB } from "../../engine-client/stubEngineClient";
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

  it("renders an Acceptance block's `\\n`-separated criteria as separate rows, not one paragraph", () => {
    // The epic brief's acceptance card is a structured list (one criterion per row). An authored
    // `meta.acceptance` box mirrors that: each `\n` line becomes its own `<li>` with a dot marker,
    // instead of the plain single-paragraph description used everywhere else.
    const criteria = "Settings exposes pickers.\nStyle engine applies the theme.\nChoices persist.";
    const { container } = renderBox(
      element({
        id: "e1",
        render: "epic",
        description: criteria,
        meta: { acceptance: "true" },
      }),
    );

    const list = container.querySelector(".diagram-node-box-criteria");
    expect(list).not.toBeNull();
    const rows = container.querySelectorAll(".diagram-node-box-criteria li");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Settings exposes pickers.");
    expect(rows[1]).toHaveTextContent("Style engine applies the theme.");
    expect(rows[2]).toHaveTextContent("Choices persist.");
    expect(screen.getByTestId("canvas-node-box-description").tagName).toBe("UL");
  });

  it("renders a task box's P (parallel) and US# tags in color", () => {
    const { container } = renderBox(
      element({
        id: "T011",
        render: "task",
        label: "T011 · Choose canvas appearance",
        description: "Add &quot;Canvas appearance&quot; section to SettingsDialog.tsx",
        meta: { us: "US1", parallel: "true" },
      }),
    );

    const box = container.querySelector(".diagram-node-box");
    expect(box).toHaveClass("diagram-node-box--task");
    const tags = container.querySelectorAll(".task-tag");
    expect(tags).toHaveLength(2);
    // The parallel flag is a green [P] tag; the story membership is a blue [US#] tag.
    const p = container.querySelector(".task-tag--p");
    const us = container.querySelector(".task-tag--us");
    expect(p).not.toBeNull();
    expect(p).toHaveTextContent("P");
    expect(us).not.toBeNull();
    expect(us).toHaveTextContent("US1");
    // The task's own text still renders alongside the tags.
    expect(screen.getByTestId("canvas-node-box-description")).toHaveTextContent("Canvas appearance");
  });

  it("renders a task box with no tags as plain text", () => {
    const { container } = renderBox(
      element({ id: "T001", render: "task", description: "Confirm web runs & bridge reachable" }),
    );
    expect(container.querySelectorAll(".task-tag")).toHaveLength(0);
    expect(screen.getByTestId("canvas-node-box-description")).toHaveTextContent("Confirm web runs");
  });

  it("marks an epics-layer box so its title is styled more prominently", () => {
    const { container } = renderBox(
      element({ id: "EP-4", render: "epic", label: "EP-4 · canvas customization" }),
    );
    const box = container.querySelector(".diagram-node-box");
    expect(box).toHaveClass("diagram-node-box--epic");
    // A bare epic title box is the column's structural header (not a content card), so it also gets
    // the root marker; a Summary/Acceptance/Спеки content card only gets the shared `--epic` marker.
    expect(box).toHaveClass("diagram-node-box--epic-root");
    const { container: card } = renderBox(
      element({ id: "s", render: "epic", meta: { summary: "true" } }),
    );
    const cardBox = card.querySelector(".diagram-node-box");
    expect(cardBox).toHaveClass("diagram-node-box--epic");
    expect(cardBox).not.toHaveClass("diagram-node-box--epic-root");
  });

  it("renders a «Спеки» block's User Stories as cards with name, why and numbered criteria", () => {
    // The epic brief's specs card is one card per user story, each with a title+priority line, a
    // muted why line, and a numbered criteria list. An authored `meta.specs` box mirrors that.
    const desc = [
      "User Story — приоритизированные.",
      "",
      "US1 · Choose canvas appearance (P1 · MVP)",
      "Ядро эпика: дать контроль над внешним видом.",
      "1. Background color → применяется сразу.",
      "2. Arrow color → все связи в новом цвете.",
      "",
      "US2 · Set maximum element count (P2)",
      "Лимит элементов ниже числа на карте.",
      "1. Кол-во элементов не превышает лимит.",
    ].join("\n");
    const { container } = renderBox(
      element({
        id: "e1",
        render: "epic",
        description: desc,
        meta: { specs: "true" },
      }),
    );

    const stories = container.querySelectorAll(".diagram-node-box-story");
    expect(stories).toHaveLength(2);
    expect(stories[0].querySelector(".diagram-node-box-story-name")).toHaveTextContent(
      "US1 · Choose canvas appearance",
    );
    expect(stories[0].querySelector(".diagram-node-box-story-prio")).toHaveTextContent("P1 · MVP");
    expect(stories[0].querySelector(".diagram-node-box-story-why")).toHaveTextContent(
      "Ядро эпика: дать контроль над внешним видом.",
    );
    const criteria = stories[0].querySelectorAll(".diagram-node-box-story-criteria li");
    expect(criteria).toHaveLength(2);
    expect(criteria[1]).toHaveTextContent("Arrow color → все связи в новом цвете.");
    expect(container.querySelector(".diagram-node-box-stories-intro")).toHaveTextContent(
      "User Story — приоритизированные.",
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

  it("shows one badge per distinct status when a box's files mix change types", () => {
    setChangesSnapshot({
      ...CHANGES,
      blocks: [
        {
          ...CHANGES.blocks[0],
          status: "modified",
          change_count: 3,
          files: [
            { path: "auth/add.go", status: "added" },
            { path: "auth/edit.go", status: "modified" },
            { path: "auth/removed.go", status: "deleted" },
          ],
        },
      ],
    });

    renderBox(element({ id: "e1", render: "impact", meta: { recipe_key: "auth" } }));

    const badges = screen.getAllByTestId("node-change-badge");
    // One chip per distinct status: added (+1), modified (~1), removed folds deleted (−1).
    expect(badges).toHaveLength(3);
    expect(badges[0]).toHaveTextContent("+1");
    expect(badges[1]).toHaveTextContent("~1");
    expect(badges[2]).toHaveTextContent("−1");
    expect(badges[0]).toHaveClass("node-change-badge--added");
    expect(badges[1]).toHaveClass("node-change-badge--modified");
    expect(badges[2]).toHaveClass("node-change-badge--removed");
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

// 054-diagram-flow-order: end-to-end through the real box, not just NodeTopBand in isolation.
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
  it("shows an explicit band segment naming the plan_kind role", () => {
    renderBox(element({ id: "e1", meta: { plan_kind: "add" } }));

    expect(screen.getByTestId("canvas-node-top-band-plan")).toHaveTextContent("ADD");
  });

  it("shows no top band when meta.plan_kind and meta.order are both absent", () => {
    renderBox(element({ id: "e1" }));

    expect(screen.queryByTestId("canvas-node-top-band")).not.toBeInTheDocument();
  });

  it("no longer applies a border accent class for plan_kind -- the band is its only trace now", () => {
    renderBox(element({ id: "e1", render: "custom", meta: { plan_kind: "modify" } }));

    expect(screen.getByTestId("canvas-node-box").className).not.toContain("plan-kind-modify");
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

// diagram_resolver.py's _stamp_no_code_reason: a resolver-computed reason a box has no node_id.
describe("CanvasNodeBox — no-code box (meta.no_code_reason)", () => {
  it("opens the description popup with a conceptual message, not the Inspector", () => {
    renderBox(
      element({
        id: "e1", node_id: null, label: "Skill authors diagram JSON", description: "",
        meta: { no_code_reason: "conceptual" },
      }),
    );

    fireEvent.click(screen.getByTestId("canvas-node-box-header"));

    expect(descriptionPopupStore.getEntry()).toEqual({
      title: "Skill authors diagram JSON",
      description: "This box stands for a concept, not a specific piece of code — there's nothing to open.",
    });
    expect(inspectorStore.getStack()).toEqual([]);
  });

  it("opens the description popup with the failed path for an unresolved box", () => {
    renderBox(
      element({
        id: "e1", node_id: null, label: "Old helper", description: "",
        meta: { no_code_reason: "unresolved", no_code_detail: "src/old_helper.py" },
      }),
    );

    fireEvent.click(screen.getByTestId("canvas-node-box-header"));

    expect(descriptionPopupStore.getEntry()?.description).toContain("src/old_helper.py");
    expect(inspectorStore.getStack()).toEqual([]);
  });

  it("prefers an authored description over the stock no-code message", () => {
    renderBox(
      element({
        id: "e1", node_id: null, label: "Auth actor", description: "The end user signing in.",
        meta: { no_code_reason: "conceptual" },
      }),
    );

    fireEvent.click(screen.getByTestId("canvas-node-box-header"));

    expect(descriptionPopupStore.getEntry()).toEqual({
      title: "Auth actor",
      description: "The end user signing in.",
    });
  });

  it("still opens the Inspector as usual for a box with a real node_id", () => {
    renderBox(element({ id: "e1", node_id: "fn:auth.py:issue" }));

    fireEvent.click(screen.getByTestId("canvas-node-box-header"));

    expect(inspectorStore.getStack()).toEqual([
      { id: "fn:auth.py:issue", name: "Auth service", sourceId: "e1" },
    ]);
    expect(descriptionPopupStore.getEntry()).toBeNull();
  });
});

// type-impact.md: the ADD/MODIFY/DELETE chip driven by an Impact box's authored meta.status.
describe("CanvasNodeBox — Impact status chip (meta.status)", () => {
  it("shows a mark plus the status role (form: '~ MODIFY'), not the bare label", () => {
    renderBox(element({ id: "e1", render: "impact", meta: { status: "modified" } }));

    expect(screen.getByTestId("impact-status-chip")).toHaveTextContent("~ MODIFY");
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

// data/Форма для задачи: meta chips sit between the title and the description, not below both.
describe("CanvasNodeBox — meta row sits between title and description", () => {
  it("renders the impact chip before the description", () => {
    const { container } = renderBox(
      element({
        id: "e1", render: "impact", meta: { status: "deleted" },
        description: "Handles charges, refunds.",
      }),
    );

    const chip = screen.getByTestId("impact-status-chip");
    const desc = container.querySelector(".diagram-node-box-desc");

    expect(chip.compareDocumentPosition(desc as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING, // chip appears before desc
    );
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

describe("CanvasNodeBox — locked layout (010-epics-tree-render Part 4)", () => {
  afterEach(() => {
    selectionStore.reset();
    canvasDocStore.reset();
    dragOffsetStore.reset();
    undoStore.reset();
  });

  it("does not start a drag on a locked-layout epic box", () => {
    const epic = element({ id: "EP-3", render: "epic", position: { x: 100, y: 100 } });
    setDoc([epic]);
    renderBox(epic);
    const box = screen.getByTestId("canvas-node-box");

    fireEvent.pointerDown(box, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 30 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 40, clientY: 30 });

    // No drag ever began: the box never registered as a collision participant, never wrote a live
    // offset, and its position was never committed.
    expect(dragOffsetStore.getAll()).toEqual({});
    expect(canvasDocStore.getDoc().elements["EP-3"].position).toEqual({ x: 100, y: 100 });
  });

  it("a spec box click opens the Inspector on its epic's brief (spec_of), not its own id", () => {
    const spec = element({
      id: "EP-3::unify-logging",
      render: "spec",
      label: "US1 · Unify logging",
      meta: { recipe_key: "EP-3", spec_of: "EP-3" },
    });
    setDoc([spec]);
    renderBox(spec);

    fireEvent.click(screen.getByTestId("canvas-node-box-header"));

    // The spec box has no work item of its own -- the click resolves `spec_of` (the epic) so the
    // inspector opens the epic's work item, whose stages hold this spec and its tasks. openId falls
    // back to the resolved work item id, exactly as an epic box's click does, so a spec click shows
    // the epic brief rather than a nonexistent per-spec work item.
    expect(inspectorStore.getStack()).toEqual([
      { id: "EP-3", name: "US1 · Unify logging", sourceId: "EP-3::unify-logging", workItemId: "EP-3" },
    ]);
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
    // Real (committed) position is (130, 120), width 300 -> left = 130 - 150 = -20, top = 120 - 36 =
    // 84. A leftover 30/20 offset would instead show left = 10, top = 104 -- the exact "jumps to a
    // different position" the moment the box is reselected, no drag involved.
    expect(boxA.style.left).toBe("-20px");
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
    expect(boxA.style.left).toBe(`${140 - 150}px`);
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

  it("shows a drop ghost when the solo drag collides with a neighbour", async () => {
    const a = element({ id: "a", label: "A", position: { x: 100, y: 100 } });
    const b = element({ id: "b", label: "B", position: { x: 115, y: 100 } });
    setDoc([a, b]);

    // jsdom rects are all 0×0; a real canvas measures blocks, so stub real geometry. The two boxes
    // sit near-overlapping, so dragging `a` onto `b` produces a correction the ghost should preview.
    const orig = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if ((this as HTMLElement).classList?.contains("canvas-content")) {
        return { left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000 } as DOMRect;
      }
      const id = (this as HTMLElement).dataset?.selectId;
      if (id === "a") return { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50 } as DOMRect;
      if (id === "b") return { left: 115, top: 0, width: 100, height: 50, right: 215, bottom: 50 } as DOMRect;
      return orig.call(this);
    });

    const { container } = render(
      <EngineClientProvider repoId="default" client={client}>
        <div className="canvas-content">
          <CanvasNodeBox element={a} />
          <CanvasNodeBox element={b} />
        </div>
      </EngineClientProvider>,
    );
    const boxA = screen.getAllByTestId("canvas-node-box")[0];

    fireEvent.pointerDown(boxA, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    // Drag far enough right that `a` fully slides over `b` — the solver must correct it.
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 150, clientY: 5 });

    // The preview is rAF-throttled, so the mid-drag update needs a frame to flush.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    expect(container.querySelector("[data-testid='drop-ghost']")).not.toBeNull();

    fireEvent.pointerUp(document, { pointerId: 1, clientX: 150, clientY: 5 });
    vi.restoreAllMocks();
  });

  it("settles a solo drag beside a neighbour instead of landing on top of it", async () => {
    const a = element({ id: "a", label: "A", position: { x: 100, y: 100 } });
    const b = element({ id: "b", label: "B", position: { x: 115, y: 100 } });
    setDoc([a, b]);

    const orig = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if ((this as HTMLElement).classList?.contains("canvas-content")) {
        return { left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000 } as DOMRect;
      }
      const id = (this as HTMLElement).dataset?.selectId;
      if (id === "a") return { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50 } as DOMRect;
      if (id === "b") return { left: 115, top: 0, width: 100, height: 50, right: 215, bottom: 50 } as DOMRect;
      return orig.call(this);
    });

    render(
      <EngineClientProvider repoId="default" client={client}>
        <div className="canvas-content">
          <CanvasNodeBox element={a} />
          <CanvasNodeBox element={b} />
        </div>
      </EngineClientProvider>,
    );
    const boxA = screen.getAllByTestId("canvas-node-box")[0];

    fireEvent.pointerDown(boxA, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    // Drag straight onto `b` — the raw release point would leave `a` overlapping it.
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 150, clientY: 5 });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 150, clientY: 5 });

    // The corrected landing animates in via a transition (SETTLE_MS) with a timeout fallback; jsdom
    // never fires transitionend, so wait out the fallback before reading the committed position.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const committed = canvasDocStore.getDoc().elements.a.position;
    // Raw release would commit x = 100 + 150 = 250, still overlapping b's right edge (215) by the
    // NODE_SEP gap — the solver must have shifted the landing well past that.
    expect(committed.x).toBeGreaterThan(250);

    vi.restoreAllMocks();
  });

  it("keeps a multi-box group move free of collision settling even when boxes overlap", () => {
    const a = element({ id: "a", label: "A", position: { x: 100, y: 100 } });
    const b = element({ id: "b", label: "B", position: { x: 105, y: 100 } });
    setDoc([a, b]);
    selectionStore.replace(["a", "b"]);

    render(
      <EngineClientProvider repoId="default" client={client}>
        <div className="canvas-content">
          <CanvasNodeBox element={a} />
          <CanvasNodeBox element={b} />
        </div>
      </EngineClientProvider>,
    );
    const boxA = screen.getAllByTestId("canvas-node-box")[0];

    fireEvent.pointerDown(boxA, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    // Drag right by 40px: `a` ends up overlapping `b`, yet both boxes must move by exactly the raw
    // pointer delta — a group move never consults the collision solver.
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 0 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 40, clientY: 0 });

    expect(canvasDocStore.getDoc().elements.a.position).toEqual({ x: 140, y: 100 });
    expect(canvasDocStore.getDoc().elements.b.position).toEqual({ x: 145, y: 100 });
  });

  it("keeps the arrows following a solo drag by publishing the live offset to dragOffsetStore", async () => {
    // Regression: the old solo `useDragOffset` passed `onPreview -> dragOffsetStore.set`, which is
    // what CanvasEdges reads (via CanvasDocView's visibleDoc) to keep an arrow anchored to the block
    // while it moves. useCollisionAvoidance swallows the onPreview slot to drive its own ghost, so
    // without the composedPreview wiring here a solo drag moved only the box -- the arrows froze at
    // the pre-drag spot and jumped into place on release.
    const a = element({ id: "a", label: "A", position: { x: 100, y: 100 } });
    const b = element({ id: "b", label: "B", position: { x: 400, y: 100 } });
    setDoc([a, b]);

    render(
      <EngineClientProvider repoId="default" client={client}>
        <div className="canvas-content">
          <CanvasNodeBox element={a} />
          <CanvasNodeBox element={b} />
        </div>
      </EngineClientProvider>,
    );
    const boxA = screen.getAllByTestId("canvas-node-box")[0];

    fireEvent.pointerDown(boxA, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 20 });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    // Mid-drag: the live offset channel has A's raw delta -- the arrows route off this the same way
    // they do for a group drag (see the group test above).
    expect(dragOffsetStore.getAll()).toEqual({ a: { x: 30, y: 20 } });

    fireEvent.pointerUp(document, { pointerId: 1, clientX: 30, clientY: 20 });
    expect(dragOffsetStore.getAll()).toEqual({});
  });
});
