import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { TreeNode } from "./TreeNode";
import { CanvasFocusContext } from "../../CanvasFocusContext";
import { CodePopupContext } from "../../CodePopupContext";
import { codeViewModeStore } from "../../codeViewModeStore";
import { EngineClientProvider } from "../../../engine-client/EngineClientContext";
import { MockBridgeEngineClient } from "../../../engine-client/mockBridge";
import { FIXTURE_NODES } from "../../../engine-client/fixtures";
import { expansionStore } from "../../../state/expansionState";
import { selectionStore } from "../../../state/selectionStore";
import { diffOverlayStore } from "../../../state/diffOverlayStore";
import { resetRefreshDiffs } from "../../../state/refreshDiffs";
import { impactChangesSidecarStore, setChangesSnapshot } from "../../../state/useSidecar";
import { inspectorStore } from "../../inspectorStore";
import type { ImpactChanges, HierarchyNodeRef } from "../../../state/types";

function renderRoot(
  onFocus?: (nodeId: string) => void,
  onCodePopupOpen?: (node: HierarchyNodeRef) => void,
) {
  render(
    <EngineClientProvider repoId="default" client={new MockBridgeEngineClient()}>
      <CanvasFocusContext.Provider value={onFocus ?? (() => {})}>
        <CodePopupContext.Provider value={onCodePopupOpen ?? (() => {})}>
          <TreeNode node={FIXTURE_NODES.root} />
        </CodePopupContext.Provider>
      </CanvasFocusContext.Provider>
    </EngineClientProvider>,
  );
}

afterEach(() => {
  resetRefreshDiffs();
  expansionStore.reset();
  selectionStore.clear();
  codeViewModeStore.reset();
  diffOverlayStore.reset();
});

async function navigateToCalculateTotal() {
  fireEvent.click(screen.getByText("examples"));
  await waitFor(() => screen.getByText("shadow-app"));
  fireEvent.click(screen.getByText("shadow-app"));
  await waitFor(() => screen.getByText("backend"));
  fireEvent.click(screen.getByText("backend"));
  await waitFor(() => screen.getByText("domain"));
  fireEvent.click(screen.getByText("domain"));
  await waitFor(() => screen.getByText("order_service.py"));
  fireEvent.click(screen.getByText("order_service.py"));
  await waitFor(() => screen.getByText("calculate_total"));
}

describe("TreeNode", () => {
  it("renders collapsed by default with no children shown", () => {
    renderRoot();
    expect(screen.getByTestId("tree-node")).toHaveAttribute("data-expand-state", "collapsed");
    expect(screen.queryByTestId("tree-node-children")).not.toBeInTheDocument();
  });

  it("expands in place on click and fetches children, without navigating (FR-002)", async () => {
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => expect(screen.getByTestId("tree-node-children")).toBeInTheDocument());
    expect(screen.getByText("shadow-app")).toBeInTheDocument();
  });

  it("expands multiple siblings simultaneously without collapsing each other (FR-003)", async () => {
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));
    fireEvent.click(screen.getByText("shadow-app"));
    await waitFor(() => screen.getByText("backend"));
    fireEvent.click(screen.getByText("backend"));
    await waitFor(() => screen.getByText("clients"));

    expect(screen.getByText("frontend")).toBeInTheDocument();
    fireEvent.click(screen.getByText("clients"));
    await waitFor(() => screen.getByText("email_client.py"));

    const backendNode = screen.getByText("backend").closest('[data-testid="tree-node"]');
    const clientsNode = screen.getByText("clients").closest('[data-testid="tree-node"]');
    expect(backendNode).toHaveAttribute("data-expand-state", "expanded");
    expect(clientsNode).toHaveAttribute("data-expand-state", "expanded");
  });

  it("collapses only the clicked node, leaving its parent expanded", async () => {
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));
    fireEvent.click(screen.getByText("shadow-app"));
    await waitFor(() => screen.getByText("backend"));
    fireEvent.click(screen.getByText("backend"));
    await waitFor(() => screen.getByText("clients"));

    fireEvent.click(screen.getByText("backend"));
    expect(screen.getByText("backend").closest('[data-testid="tree-node"]')).toHaveAttribute(
      "data-expand-state",
      "collapsed",
    );
    expect(screen.getByText("shadow-app").closest('[data-testid="tree-node"]')).toHaveAttribute(
      "data-expand-state",
      "expanded",
    );
  });

  it("does not expand a leaf node with no children on click", async () => {
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));
    fireEvent.click(screen.getByText("shadow-app"));
    await waitFor(() => screen.getByText("frontend"));
    fireEvent.click(screen.getByText("frontend"));
    await waitFor(() => screen.getByText("src"));
    fireEvent.click(screen.getByText("src"));
    await waitFor(() => screen.getByText("domain"));
    fireEvent.click(screen.getByText("domain"));
    await waitFor(() => screen.getByText("types.ts"));
    fireEvent.click(screen.getByText("types.ts"));
    expect(screen.getByText("types.ts").closest('[data-testid="tree-node"]')).toHaveAttribute(
      "data-expand-state",
      "collapsed",
    );
  });

  it("clicking the focus button centers this node without toggling its expand state", () => {
    const onFocus = vi.fn();
    renderRoot(onFocus);

    fireEvent.click(screen.getByRole("button", { name: `Center ${FIXTURE_NODES.root.name}` }));

    expect(onFocus).toHaveBeenCalledWith(FIXTURE_NODES.root.node_id);
    expect(screen.getByTestId("tree-node")).toHaveAttribute("data-expand-state", "collapsed");
  });

  it("opens the code popup via the code button in popup mode, not by clicking the row", async () => {
    const onCodePopupOpen = vi.fn();
    renderRoot(undefined, onCodePopupOpen);
    await navigateToCalculateTotal();
    act(() => codeViewModeStore.setMode("popup"));

    fireEvent.click(screen.getByText("calculate_total"));
    expect(onCodePopupOpen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show code for calculate_total" }));

    expect(onCodePopupOpen).toHaveBeenCalledWith(
      expect.objectContaining({ node_id: "function::calculate_total" }),
    );
    expect(
      screen.getByText("calculate_total").closest('[data-testid="tree-node"]'),
    ).toHaveAttribute("data-expand-state", "collapsed");
  });

  it("shows the code inline instead of opening a popup once inline mode is active", async () => {
    const onCodePopupOpen = vi.fn();
    renderRoot(undefined, onCodePopupOpen);
    await navigateToCalculateTotal();
    act(() => codeViewModeStore.setMode("inline"));

    fireEvent.click(screen.getByRole("button", { name: "Show code for calculate_total" }));

    expect(onCodePopupOpen).not.toHaveBeenCalled();
    const functionNode = document.querySelector(
      '[data-node-id="function::calculate_total"]',
    ) as HTMLElement;
    expect(functionNode.querySelector('[data-testid="block-code-view"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide code for calculate_total" }));
    expect(functionNode.querySelector('[data-testid="block-code-view"]')).not.toBeInTheDocument();
  });

  it("lets the inline code panel be dragged by its header, resetting on close and reopen", async () => {
    renderRoot();
    act(() => codeViewModeStore.setMode("inline"));
    await navigateToCalculateTotal();
    fireEvent.click(screen.getByRole("button", { name: "Show code for calculate_total" }));
    const panel = screen.getByTestId("block-code-view");
    const header = screen.getByTestId("block-code-view-header");

    fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 140, clientY: 130 });
    fireEvent.pointerUp(header, { pointerId: 1, clientX: 140, clientY: 130 });

    expect(panel.style.transform).toBe("translate(40px, 30px)");

    // Closing unmounts the panel, so reopening starts back at the origin (transient state).
    fireEvent.click(screen.getByRole("button", { name: "Hide code for calculate_total" }));
    fireEvent.click(screen.getByRole("button", { name: "Show code for calculate_total" }));
    expect(screen.getByTestId("block-code-view").style.transform).toBe("translate(0px, 0px)");
  });

  it("expands a class-level row to reveal its method children", async () => {
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));
    fireEvent.click(screen.getByText("shadow-app"));
    await waitFor(() => screen.getByText("backend"));
    fireEvent.click(screen.getByText("backend"));
    await waitFor(() => screen.getByText("clients"));
    fireEvent.click(screen.getByText("clients"));
    await waitFor(() => screen.getByText("email_client.py"));
    fireEvent.click(screen.getByText("email_client.py"));
    await waitFor(() => screen.getByText("EmailClient"));

    fireEvent.click(screen.getByText("EmailClient"));

    await waitFor(() => screen.getByText("send"));
    expect(screen.getByText("_format_subject")).toBeInTheDocument();
    expect(
      screen.getByText("EmailClient").closest('[data-testid="tree-node"]'),
    ).toHaveAttribute("data-expand-state", "expanded");
  });

  it("shows a class's whole source via a Show Class button, same as a file's Show File button", async () => {
    const onCodePopupOpen = vi.fn();
    renderRoot(undefined, onCodePopupOpen);
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));
    fireEvent.click(screen.getByText("shadow-app"));
    await waitFor(() => screen.getByText("backend"));
    fireEvent.click(screen.getByText("backend"));
    await waitFor(() => screen.getByText("clients"));
    fireEvent.click(screen.getByText("clients"));
    await waitFor(() => screen.getByText("email_client.py"));
    fireEvent.click(screen.getByText("email_client.py"));
    await waitFor(() => screen.getByText("EmailClient"));
    fireEvent.click(screen.getByText("EmailClient"));
    await waitFor(() => screen.getByText("send"));

    const classNode = document.querySelector('[data-node-id="class::EmailClient"]') as HTMLElement;

    // Popup mode: the class button opens the popup, like a file's button does.
    act(() => codeViewModeStore.setMode("popup"));
    fireEvent.click(within(classNode).getByRole("button", { name: "Show class for EmailClient" }));
    expect(onCodePopupOpen).toHaveBeenCalledWith(
      expect.objectContaining({ node_id: "class::EmailClient" }),
    );

    // Inline mode: hides the class's method sub-rows while its code view is open, and restores
    // them exactly as with a file.
    act(() => codeViewModeStore.setMode("inline"));
    fireEvent.click(within(classNode).getByRole("button", { name: "Show class for EmailClient" }));

    expect(classNode.querySelector('[data-testid="block-code-view"]')).toBeInTheDocument();
    expect(classNode.querySelector('[data-testid="tree-node-children"]')).not.toBeInTheDocument();

    fireEvent.click(within(classNode).getByRole("button", { name: "Hide class for EmailClient" }));
    expect(classNode.querySelector('[data-testid="block-code-view"]')).not.toBeInTheDocument();
    expect(classNode.querySelector('[data-testid="tree-node-children"]')).toBeInTheDocument();
    expect(within(classNode).getByText("send")).toBeInTheDocument();
  });

  it("renders a diff instead of plain code once a diff exists for the node", async () => {
    renderRoot();
    act(() => codeViewModeStore.setMode("inline"));
    await navigateToCalculateTotal();

    act(() => {
      diffOverlayStore.write([
        {
          node_id: "function::calculate_total",
          original_source: FIXTURE_NODES["function::calculate_total"].source ?? "",
          proposed_source: "def calculate_total(items):\n    return 0",
        },
      ]);
      expansionStore.showCode("function::calculate_total");
    });

    const functionNode = document.querySelector(
      '[data-node-id="function::calculate_total"]',
    ) as HTMLElement;
    expect(functionNode.querySelector('[data-testid="diff-view"]')).toBeInTheDocument();
    expect(functionNode.querySelector('[data-testid="block-code-view"]')).not.toBeInTheDocument();
  });

  it("accepting a diff commits it via acceptDiff and closes the code view", async () => {
    renderRoot();
    act(() => codeViewModeStore.setMode("inline"));
    await navigateToCalculateTotal();

    const acceptSpy = vi.spyOn(MockBridgeEngineClient.prototype, "acceptDiff");
    act(() => {
      diffOverlayStore.write([
        {
          node_id: "function::calculate_total",
          original_source: FIXTURE_NODES["function::calculate_total"].source ?? "",
          proposed_source: "def calculate_total(items):\n    return 0",
        },
      ]);
      expansionStore.showCode("function::calculate_total");
    });

    const functionNode = document.querySelector(
      '[data-node-id="function::calculate_total"]',
    ) as HTMLElement;
    fireEvent.click(within(functionNode).getByTestId("diff-accept-button"));

    expect(acceptSpy).toHaveBeenCalledWith("function::calculate_total");
    await waitFor(() => expect(functionNode).toHaveAttribute("data-code-visible", "false"));
    expect(functionNode.querySelector('[data-testid="diff-view"]')).not.toBeInTheDocument();
    expect(functionNode.querySelector('[data-testid="block-code-view"]')).not.toBeInTheDocument();

    acceptSpy.mockRestore();
  });

  it("leaves the code view open and shows the error when accepting a diff fails", async () => {
    renderRoot();
    act(() => codeViewModeStore.setMode("inline"));
    await navigateToCalculateTotal();

    const acceptSpy = vi
      .spyOn(MockBridgeEngineClient.prototype, "acceptDiff")
      .mockRejectedValueOnce(new Error("boom"));
    act(() => {
      diffOverlayStore.write([
        {
          node_id: "function::calculate_total",
          original_source: FIXTURE_NODES["function::calculate_total"].source ?? "",
          proposed_source: "def calculate_total(items):\n    return 0",
        },
      ]);
      expansionStore.showCode("function::calculate_total");
    });

    const functionNode = document.querySelector(
      '[data-node-id="function::calculate_total"]',
    ) as HTMLElement;
    fireEvent.click(within(functionNode).getByTestId("diff-accept-button"));

    await waitFor(() =>
      expect(within(functionNode).getByTestId("diff-accept-error")).toBeInTheDocument(),
    );
    expect(functionNode).toHaveAttribute("data-code-visible", "true");
    expect(functionNode.querySelector('[data-testid="diff-view"]')).toBeInTheDocument();

    acceptSpy.mockRestore();
  });

  it("diff-reveals a class inside a file: file keeps showing children, class shows its added diff", async () => {
    renderRoot();
    act(() => codeViewModeStore.setMode("inline"));
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));
    fireEvent.click(screen.getByText("shadow-app"));
    await waitFor(() => screen.getByText("backend"));
    fireEvent.click(screen.getByText("backend"));
    await waitFor(() => screen.getByText("clients"));
    fireEvent.click(screen.getByText("clients"));
    await waitFor(() => screen.getByText("email_client.py"));
    fireEvent.click(screen.getByText("email_client.py"));
    await waitFor(() => screen.getByText("EmailClient"));

    act(() => {
      diffOverlayStore.write([
        {
          node_id: "class::EmailClient",
          status: "added",
          level: "class",
          original_source: "",
          proposed_source: "class EmailClient:\n    def send(self): ...",
        },
      ]);
      expansionStore.showCode("class::EmailClient");
    });

    const fileNode = document.querySelector(
      '[data-node-id="file::shadow-app/backend/clients/email_client.py"]',
    ) as HTMLElement;
    const classNode = document.querySelector('[data-node-id="class::EmailClient"]') as HTMLElement;

    expect(classNode.querySelector('[data-testid="diff-view"]')).toBeInTheDocument();
    expect(fileNode.getAttribute("data-code-visible")).toBe("false");
    expect(fileNode.querySelector('[data-testid="tree-node-children"]')).toBeInTheDocument();
  });

  it("renders the params signature next to a function row", async () => {
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));
    fireEvent.click(screen.getByText("shadow-app"));
    await waitFor(() => screen.getByText("backend"));
    fireEvent.click(screen.getByText("backend"));
    await waitFor(() => screen.getByText("domain"));
    fireEvent.click(screen.getByText("domain"));
    await waitFor(() => screen.getByText("order_service.py"));
    fireEvent.click(screen.getByText("order_service.py"));

    await waitFor(() =>
      expect(screen.getByText("(items: list[OrderItem]) -> float")).toBeInTheDocument(),
    );
  });
});

function renderFolderTreeNode(docOnly: boolean | undefined) {
  const node: HierarchyNodeRef = {
    node_id: "dir::docs",
    name: "docs",
    level: "folder",
    parent_id: null,
    has_children: false,
    child_count: 0,
    doc_only: docOnly,
  };
  render(
    <EngineClientProvider repoId="default" client={new MockBridgeEngineClient()}>
      <CanvasFocusContext.Provider value={() => {}}>
        <CodePopupContext.Provider value={() => {}}>
          <TreeNode node={node} />
        </CodePopupContext.Provider>
      </CanvasFocusContext.Provider>
    </EngineClientProvider>,
  );
}

describe("TreeNode selection", () => {
  // The tree strategy has no group-drag participant at any level (unlike the boxes strategy's
  // top-level System boxes — see TopLevelChildren.tsx/useNodeChrome's `selectable`), so a row never
  // joins selectionStore at all: a shift-click just falls through to the row's normal action.
  it("shift-clicking a row's label never selects it, and still expands it", () => {
    renderRoot();

    fireEvent.click(screen.getByText(FIXTURE_NODES.root.name), { shiftKey: true });

    const row = screen.getByTestId("tree-node");
    expect(row).toHaveAttribute("data-expand-state", "expanded");
    expect(row).not.toHaveClass("block-selected");
    expect(selectionStore.isSelected(FIXTURE_NODES.root.node_id)).toBe(false);
  });

  it("a plain click on the label clears an existing selection and still expands", () => {
    renderRoot();
    selectionStore.replace(["some-other-node"]);

    fireEvent.click(screen.getByText(FIXTURE_NODES.root.name));

    expect(selectionStore.getSelectedIds()).toEqual([]);
    expect(screen.getByTestId("tree-node")).toHaveAttribute("data-expand-state", "expanded");
  });
});

describe("TreeNode doc_only folder styling", () => {
  it("adds the tree-node-doc-only class for a folder node with doc_only true", () => {
    renderFolderTreeNode(true);
    expect(screen.getByTestId("tree-node")).toHaveClass("tree-node-doc-only");
  });

  it("omits the tree-node-doc-only class for a folder node with doc_only false or absent", () => {
    renderFolderTreeNode(undefined);
    expect(screen.getByTestId("tree-node")).not.toHaveClass("tree-node-doc-only");
  });
});

describe("TreeNode copy button", () => {
  it("copies a folder's path without toggling the row's expand state", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));

    fireEvent.click(screen.getByRole("button", { name: "Copy shadow-app" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("shadow-app"));
    expect(screen.getByText("shadow-app").closest('[data-testid="tree-node"]')).toHaveAttribute(
      "data-expand-state",
      "collapsed",
    );
  });
});

// The C1 view mounts these rows for its authored blocks, whose whole meaning is the description —
// including the "path not found" note on an unresolved one, which has nothing else to show.
function renderDescribedTreeNode(hasChildren: boolean) {
  const node: HierarchyNodeRef = {
    node_id: "c1-sub::db/gone",
    name: "Gone",
    level: "folder",
    parent_id: "c1-actor::db",
    has_children: hasChildren,
    child_count: 0,
    description: "⚠ Path not found in graph: src/gone",
  };
  render(
    <EngineClientProvider repoId="default" client={new MockBridgeEngineClient()}>
      <CanvasFocusContext.Provider value={() => {}}>
        <CodePopupContext.Provider value={() => {}}>
          <TreeNode node={node} />
        </CodePopupContext.Provider>
      </CanvasFocusContext.Provider>
    </EngineClientProvider>,
  );
}

describe("TreeNode description", () => {
  it("reveals the description on expand and hides it again on collapse", () => {
    renderDescribedTreeNode(true);
    expect(screen.queryByTestId("tree-node-description")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Gone"));
    expect(screen.getByTestId("tree-node-description")).toHaveTextContent(
      "⚠ Path not found in graph: src/gone",
    );

    fireEvent.click(screen.getByText("Gone"));
    expect(screen.queryByTestId("tree-node-description")).not.toBeInTheDocument();
  });

  it("expands a childless row on click when a description is all it has to show", () => {
    renderDescribedTreeNode(false);

    fireEvent.click(screen.getByText("Gone"));

    expect(screen.getByTestId("tree-node")).toHaveAttribute("data-expand-state", "expanded");
    expect(screen.getByTestId("tree-node-description")).toBeInTheDocument();
  });

  it("renders no children container when expanding a description-only row", () => {
    renderDescribedTreeNode(false);

    fireEvent.click(screen.getByText("Gone"));

    expect(screen.queryByTestId("tree-node-children")).not.toBeInTheDocument();
  });
});

describe("TreeNode — a node with its own change review", () => {
  afterEach(() => {
    impactChangesSidecarStore.reset();
    inspectorStore.reset();
  });

  const CHANGES: ImpactChanges = {
    fingerprint: "f1",
    reviewed_fingerprint: "f1",
    has_review: true,
    stale: false,
    summary: "",
    blocks: [
      {
        block: "system/root",
        node_id: FIXTURE_NODES.root.node_id,
        name: FIXTURE_NODES.root.name,
        path: "root",
        status: "modified",
        files: [{ path: "root.py", status: "modified" }],
        change_count: 1,
        before: "",
        after: "",
        explanation: "changed",
        pr_comments: [],
      },
    ],
    ghosts: [],
    relationships: [],
    unassigned: [],
    changed_file_count: 1,
    general_pr_comments: [],
  };

  it("opens the InspectorPanel on its own review instead of expanding in place", () => {
    // Regression: this used to redirect through the now-deleted C1InspectorContext, which was never
    // provided outside the old (deleted) C1View -- so on the main canvas `openInInspector` silently
    // no-op'd and the click did nothing at all, neither opening the panel nor falling back to expand.
    setChangesSnapshot(CHANGES);
    renderRoot();

    fireEvent.click(screen.getByText(FIXTURE_NODES.root.name));

    expect(inspectorStore.getStack()).toEqual([
      { id: FIXTURE_NODES.root.node_id, name: FIXTURE_NODES.root.name },
    ]);
    expect(screen.getByTestId("tree-node")).toHaveAttribute("data-expand-state", "collapsed");
  });

  it("still expands normally once there is no review touching it", () => {
    renderRoot();

    fireEvent.click(screen.getByText(FIXTURE_NODES.root.name));

    expect(inspectorStore.getStack()).toEqual([]);
    expect(screen.getByTestId("tree-node")).toHaveAttribute("data-expand-state", "expanded");
  });
});
