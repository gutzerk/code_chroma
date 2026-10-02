import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { Block } from "./Block";
import { TreeNode } from "../tree/TreeNode";
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
import { agentStore } from "../../../agents/agentStore";
import { workspaceStore } from "../../../agents/workspaceStore";
import type { HierarchyNodeRef } from "../../../state/types";

function renderRoot(
  onFocus?: (nodeId: string) => void,
  onCodePopupOpen?: (node: HierarchyNodeRef) => void,
  selectable?: boolean,
) {
  render(
    <EngineClientProvider repoId="default" client={new MockBridgeEngineClient()}>
      <CanvasFocusContext.Provider value={onFocus ?? (() => {})}>
        <CodePopupContext.Provider value={onCodePopupOpen ?? (() => {})}>
          <Block node={FIXTURE_NODES.root} selectable={selectable} />
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
  workspaceStore.reset();
  agentStore.reset();
});

async function navigateToCalculateTotal() {
  fireEvent.click(screen.getByText("examples"));
  await waitFor(() => screen.getByText("shadow-app"), { timeout: 5000 });
  fireEvent.click(screen.getByText("shadow-app"));
  await waitFor(() => screen.getByText("backend"), { timeout: 5000 });
  fireEvent.click(screen.getByText("backend"));
  await waitFor(() => screen.getByText("domain"), { timeout: 5000 });
  fireEvent.click(screen.getByText("domain"));
  // These last two hops land after the most accumulated render work in the chain, so they get a
  // longer timeout than RTL's 1000ms default — CI runners under load can miss that window.
  await waitFor(() => screen.getByText("order_service.py"), { timeout: 5000 });
  fireEvent.click(screen.getByText("order_service.py"));
  await waitFor(() => screen.getByText("calculate_total"), { timeout: 5000 });
}

describe("Block", () => {
  it("renders collapsed by default with no children shown", () => {
    renderRoot();
    expect(screen.getByTestId("block")).toHaveAttribute("data-expand-state", "collapsed");
    expect(screen.queryByTestId("block-children")).not.toBeInTheDocument();
  });

  it("expands in place on click and fetches children, without navigating (FR-002)", async () => {
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    // The root's own children render as independently positioned top-level boxes, not the ordinary
    // block-children flow container — see the "Block top-level children" describe block below.
    await waitFor(() => expect(screen.getByTestId("hierarchy-top-level")).toBeInTheDocument());
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

    // backend's other sibling (frontend) is untouched and independently clickable —
    // simulate a second top-level expansion path to prove independence.
    expect(screen.getByText("frontend")).toBeInTheDocument();
    fireEvent.click(screen.getByText("clients"));
    await waitFor(() => screen.getByText("email_client.py"));

    // Both backend and clients remain expanded at the same time (arbitrary simultaneous
    // depth, FR-004).
    const backendBlock = screen.getByText("backend").closest('[data-testid="block"]');
    const clientsBlock = screen.getByText("clients").closest('[data-testid="block"]');
    expect(backendBlock).toHaveAttribute("data-expand-state", "expanded");
    expect(clientsBlock).toHaveAttribute("data-expand-state", "expanded");
  });

  it("reaches arbitrary simultaneous depth down to a leaf and back up remains expanded (FR-004)", async () => {
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));
    fireEvent.click(screen.getByText("shadow-app"));
    await waitFor(() => screen.getByText("backend"));
    fireEvent.click(screen.getByText("backend"));
    await waitFor(() => screen.getByText("clients"));
    fireEvent.click(screen.getByText("clients"));
    await waitFor(() => screen.getByText("email_client.py"));

    for (const name of ["examples", "shadow-app", "backend", "clients"]) {
      const block = screen.getByText(name).closest('[data-testid="block"]');
      expect(block).toHaveAttribute("data-expand-state", "expanded");
    }
  });

  it("collapses only the clicked block, leaving its parent expanded", async () => {
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));
    fireEvent.click(screen.getByText("shadow-app"));
    await waitFor(() => screen.getByText("backend"));
    fireEvent.click(screen.getByText("backend"));
    await waitFor(() => screen.getByText("clients"));

    fireEvent.click(screen.getByText("backend"));
    expect(screen.getByText("backend").closest('[data-testid="block"]')).toHaveAttribute(
      "data-expand-state",
      "collapsed",
    );
    expect(screen.getByText("shadow-app").closest('[data-testid="block"]')).toHaveAttribute(
      "data-expand-state",
      "expanded",
    );
  });

  it("does not expand a leaf block with no children on click", async () => {
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    expect(screen.getByText("examples").closest('[data-testid="block"]')).toHaveAttribute(
      "data-expand-state",
      "expanded",
    );
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
    expect(screen.getByText("types.ts").closest('[data-testid="block"]')).toHaveAttribute(
      "data-expand-state",
      "collapsed",
    );
  });

  it("clicking the focus button centers this block without toggling its expand state", () => {
    const onFocus = vi.fn();
    renderRoot(onFocus);

    fireEvent.click(screen.getByRole("button", { name: `Center ${FIXTURE_NODES.root.name}` }));

    expect(onFocus).toHaveBeenCalledWith(FIXTURE_NODES.root.node_id);
    expect(screen.getByTestId("block")).toHaveAttribute("data-expand-state", "collapsed");
  });

  it("opens the code popup via the code button in popup mode, not by clicking the block body", async () => {
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
    const functionBlock = screen.getByText("calculate_total").closest('[data-testid="block"]');
    expect(functionBlock).toHaveAttribute("data-expand-state", "collapsed");
    expect(functionBlock).toHaveClass("block-function");
  });

  it("shows the code inline instead of opening a popup once inline mode is active", async () => {
    const onCodePopupOpen = vi.fn();
    renderRoot(undefined, onCodePopupOpen);
    await navigateToCalculateTotal();
    act(() => codeViewModeStore.setMode("inline"));

    fireEvent.click(screen.getByRole("button", { name: "Show code for calculate_total" }));

    expect(onCodePopupOpen).not.toHaveBeenCalled();
    const functionBlock = document.querySelector(
      '[data-node-id="function::calculate_total"]',
    ) as HTMLElement;
    expect(functionBlock.querySelector('[data-testid="block-code-view"]')).toBeInTheDocument();
    expect(functionBlock).toHaveAttribute("data-code-visible", "true");

    fireEvent.click(screen.getByRole("button", { name: "Hide code for calculate_total" }));
    expect(functionBlock.querySelector('[data-testid="block-code-view"]')).not.toBeInTheDocument();
  });

  it("hides a file's sub-blocks while its full-file code view is open, and restores them when closed", async () => {
    renderRoot();
    act(() => codeViewModeStore.setMode("inline"));
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));
    fireEvent.click(screen.getByText("shadow-app"));
    await waitFor(() => screen.getByText("backend"));
    fireEvent.click(screen.getByText("backend"));
    await waitFor(() => screen.getByText("domain"));
    fireEvent.click(screen.getByText("domain"));
    // These last two hops land after the most accumulated render work in the chain, so they get a
    // longer timeout than RTL's 1000ms default — CI runners under load can miss that window.
    await waitFor(() => screen.getByText("order_service.py"), { timeout: 5000 });
    fireEvent.click(screen.getByText("order_service.py"));
    await waitFor(() => screen.getByText("calculate_total"), { timeout: 5000 });

    const fileBlock = screen.getByText("order_service.py").closest('[data-testid="block"]') as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: "Show full file for order_service.py" }));

    expect(fileBlock.querySelector('[data-testid="block-code-view"]')).toBeInTheDocument();
    expect(fileBlock.querySelector('[data-testid="block-children"]')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide full file for order_service.py" }));
    expect(fileBlock.querySelector('[data-testid="block-code-view"]')).not.toBeInTheDocument();
    expect(fileBlock.querySelector('[data-testid="block-children"]')).toBeInTheDocument();
    expect(screen.getByText("calculate_total")).toBeInTheDocument();
  });

  it("clicking a block body while its code view is open does not close it or toggle expand state", async () => {
    renderRoot();
    act(() => codeViewModeStore.setMode("inline"));
    await navigateToCalculateTotal();
    fireEvent.click(screen.getByRole("button", { name: "Show code for calculate_total" }));

    const functionBlock = document.querySelector(
      '[data-node-id="function::calculate_total"]',
    ) as HTMLElement;
    fireEvent.click(functionBlock);

    expect(functionBlock.querySelector('[data-testid="block-code-view"]')).toBeInTheDocument();
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

  it("expands a class-level block to reveal its method children", async () => {
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
    const classBlock = screen.getByText("EmailClient").closest('[data-testid="block"]');
    expect(classBlock).toHaveAttribute("data-expand-state", "expanded");
    expect(classBlock).toHaveClass("block-class");
    expect(classBlock?.querySelector('[data-testid="block-children"]')).toHaveClass(
      "block-children-column",
    );
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

    const classBlock = document.querySelector('[data-node-id="class::EmailClient"]') as HTMLElement;

    // Popup mode: the class button opens the popup, like a file's button does.
    act(() => codeViewModeStore.setMode("popup"));
    fireEvent.click(within(classBlock).getByRole("button", { name: "Show class for EmailClient" }));
    expect(onCodePopupOpen).toHaveBeenCalledWith(
      expect.objectContaining({ node_id: "class::EmailClient" }),
    );

    // Inline mode: hides the class's method sub-blocks while its code view is open, and restores
    // them exactly as with a file.
    act(() => codeViewModeStore.setMode("inline"));
    fireEvent.click(within(classBlock).getByRole("button", { name: "Show class for EmailClient" }));

    expect(classBlock.querySelector('[data-testid="block-code-view"]')).toBeInTheDocument();
    expect(classBlock.querySelector('[data-testid="block-children"]')).not.toBeInTheDocument();
    expect(classBlock.getAttribute("data-code-visible")).toBe("true");

    fireEvent.click(within(classBlock).getByRole("button", { name: "Hide class for EmailClient" }));
    expect(classBlock.querySelector('[data-testid="block-code-view"]')).not.toBeInTheDocument();
    expect(classBlock.querySelector('[data-testid="block-children"]')).toBeInTheDocument();
    expect(within(classBlock).getByText("send")).toBeInTheDocument();
  });

  it("lays out a folder's children in a wrapping row, not a column", async () => {
    // "shadow-app" (not root — root's own children use the top-level drag layout instead) has two
    // children, well under the 5-column cap.
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));
    fireEvent.click(screen.getByText("shadow-app"));
    await waitFor(() => screen.getByText("backend"));

    const shadowAppBlock = screen.getByText("shadow-app").closest('[data-testid="block"]');
    const shadowAppChildren = shadowAppBlock!.querySelector('[data-testid="block-children"]');
    expect(shadowAppChildren).toHaveClass("block-children-row");
  });

  it("sizes the row's grid columns to the actual child count when there are fewer than 5", async () => {
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));
    fireEvent.click(screen.getByText("shadow-app"));
    await waitFor(() => screen.getByText("backend"));

    const shadowAppBlock = screen.getByText("shadow-app").closest('[data-testid="block"]');
    const shadowAppChildren = shadowAppBlock!.querySelector(
      '[data-testid="block-children"]',
    ) as HTMLElement;
    // "shadow-app" has two children (backend, frontend) in the fixture tree.
    expect(shadowAppChildren.style.getPropertyValue("--block-child-columns")).toBe("2");
  });

  it("lays out a folder's children in a single column when it has more than 5 children", async () => {
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));
    fireEvent.click(screen.getByText("shadow-app"));
    await waitFor(() => screen.getByText("backend"));
    fireEvent.click(screen.getByText("backend"));
    await waitFor(() => screen.getByText("clients"));

    // "backend" has 8 children in the fixture tree, well above the 5-column row cap, so it must
    // stack in a single column instead of wrapping into a second grid row.
    const backendBlock = screen.getByText("backend").closest('[data-testid="block"]');
    const backendChildren = backendBlock?.querySelector('[data-testid="block-children"]') as HTMLElement;
    expect(backendChildren).toHaveClass("block-children-column");
  });

  it("renders a diff instead of plain code once a diff exists for the node", async () => {
    renderRoot();
    act(() => codeViewModeStore.setMode("inline"));
    await navigateToCalculateTotal();

    act(() => {
      diffOverlayStore.setDiffs([
        {
          node_id: "function::calculate_total",
          original_source: FIXTURE_NODES["function::calculate_total"].source ?? "",
          proposed_source: "def calculate_total(items):\n    return 0",
        },
      ]);
      expansionStore.showCode("function::calculate_total");
    });

    const functionBlock = document.querySelector(
      '[data-node-id="function::calculate_total"]',
    ) as HTMLElement;
    expect(functionBlock.querySelector('[data-testid="diff-view"]')).toBeInTheDocument();
    expect(functionBlock.querySelector('[data-testid="block-code-view"]')).not.toBeInTheDocument();
  });

  it("accepting a diff commits it via acceptDiff and closes the code view", async () => {
    renderRoot();
    act(() => codeViewModeStore.setMode("inline"));
    await navigateToCalculateTotal();

    const acceptSpy = vi.spyOn(MockBridgeEngineClient.prototype, "acceptDiff");
    act(() => {
      diffOverlayStore.setDiffs([
        {
          node_id: "function::calculate_total",
          original_source: FIXTURE_NODES["function::calculate_total"].source ?? "",
          proposed_source: "def calculate_total(items):\n    return 0",
        },
      ]);
      expansionStore.showCode("function::calculate_total");
    });

    const functionBlock = document.querySelector(
      '[data-node-id="function::calculate_total"]',
    ) as HTMLElement;
    fireEvent.click(within(functionBlock).getByTestId("diff-accept-button"));

    expect(acceptSpy).toHaveBeenCalledWith("function::calculate_total");
    await waitFor(() => expect(functionBlock).toHaveAttribute("data-code-visible", "false"));
    expect(functionBlock.querySelector('[data-testid="diff-view"]')).not.toBeInTheDocument();
    expect(functionBlock.querySelector('[data-testid="block-code-view"]')).not.toBeInTheDocument();

    acceptSpy.mockRestore();
  });

  it("offers no Accept in a read-only workspace, but still shows the diff", async () => {
    renderRoot();
    act(() => codeViewModeStore.setMode("inline"));
    await navigateToCalculateTotal();

    act(() => {
      agentStore.setActiveWorkspace("pr-7");
      workspaceStore.setStatus({
        id: "pr-7", state: "ready", progress: "", error: null, read_only: true,
      });
      diffOverlayStore.setDiffs([
        {
          node_id: "function::calculate_total",
          original_source: FIXTURE_NODES["function::calculate_total"].source ?? "",
          proposed_source: "def calculate_total(items):\n    return 0",
        },
      ]);
      expansionStore.showCode("function::calculate_total");
    });

    const functionBlock = document.querySelector(
      '[data-node-id="function::calculate_total"]',
    ) as HTMLElement;
    expect(functionBlock.querySelector('[data-testid="diff-view"]')).toBeInTheDocument();
    expect(
      functionBlock.querySelector('[data-testid="diff-accept-button"]'),
    ).not.toBeInTheDocument();
  });

  it("leaves the code view open and shows the error when accepting a diff fails", async () => {
    renderRoot();
    act(() => codeViewModeStore.setMode("inline"));
    await navigateToCalculateTotal();

    const acceptSpy = vi
      .spyOn(MockBridgeEngineClient.prototype, "acceptDiff")
      .mockRejectedValueOnce(new Error("boom"));
    act(() => {
      diffOverlayStore.setDiffs([
        {
          node_id: "function::calculate_total",
          original_source: FIXTURE_NODES["function::calculate_total"].source ?? "",
          proposed_source: "def calculate_total(items):\n    return 0",
        },
      ]);
      expansionStore.showCode("function::calculate_total");
    });

    const functionBlock = document.querySelector(
      '[data-node-id="function::calculate_total"]',
    ) as HTMLElement;
    fireEvent.click(within(functionBlock).getByTestId("diff-accept-button"));

    await waitFor(() =>
      expect(within(functionBlock).getByTestId("diff-accept-error")).toBeInTheDocument(),
    );
    expect(functionBlock).toHaveAttribute("data-code-visible", "true");
    expect(functionBlock.querySelector('[data-testid="diff-view"]')).toBeInTheDocument();

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

    // Simulate the diff reveal: the file is expanded (not code-shown) and the class shows its
    // added source — exactly what revealDiffEntry does for level "file" vs "class".
    act(() => {
      diffOverlayStore.setDiffs([
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

    const fileBlock = document.querySelector(
      '[data-node-id="file::shadow-app/backend/clients/email_client.py"]',
    ) as HTMLElement;
    const classBlock = document.querySelector('[data-node-id="class::EmailClient"]') as HTMLElement;

    // The class shows its diff (its added code is visible)...
    expect(classBlock.querySelector('[data-testid="diff-view"]')).toBeInTheDocument();
    // ...and the file did NOT switch to code view, so the class block itself stays rendered.
    expect(fileBlock.getAttribute("data-code-visible")).toBe("false");
    expect(fileBlock.querySelector('[data-testid="block-children"]')).toBeInTheDocument();
  });

  it("renders the params signature inside a function block", async () => {
    renderRoot();
    await navigateToCalculateTotal();

    await waitFor(() =>
      expect(screen.getByText("(items: list[OrderItem]) -> float")).toBeInTheDocument(),
    );
  }, 30_000);
});

function renderFolderBlock(docOnly: boolean | undefined) {
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
          <Block node={node} />
        </CodePopupContext.Provider>
      </CanvasFocusContext.Provider>
    </EngineClientProvider>,
  );
}

describe("Block doc_only folder styling", () => {
  it("adds the block-doc-only class for a folder node with doc_only true", () => {
    renderFolderBlock(true);
    expect(screen.getByTestId("block")).toHaveClass("block-doc-only");
  });

  it("omits the block-doc-only class for a folder node with doc_only false or absent", () => {
    renderFolderBlock(undefined);
    expect(screen.getByTestId("block")).not.toHaveClass("block-doc-only");
  });
});

function renderDescribedBlock(className?: string) {
  const node: HierarchyNodeRef = {
    node_id: "c1-actor::dev",
    name: "Developer",
    level: "code",
    parent_id: null,
    has_children: false,
    child_count: 0,
    description: "Uses the app.",
  };
  render(
    <EngineClientProvider repoId="default" client={new MockBridgeEngineClient()}>
      <CanvasFocusContext.Provider value={() => {}}>
        <CodePopupContext.Provider value={() => {}}>
          <Block node={node} className={className} />
        </CodePopupContext.Provider>
      </CanvasFocusContext.Provider>
    </EngineClientProvider>,
  );
}

describe("Block description", () => {
  it("reveals the description on expand and hides it again on collapse", () => {
    renderDescribedBlock();
    expect(screen.queryByTestId("block-description")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Developer"));
    expect(screen.getByTestId("block-description")).toHaveTextContent("Uses the app.");
    expect(screen.queryByTestId("block-children")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Developer"));
    expect(screen.queryByTestId("block-description")).not.toBeInTheDocument();
  });

  it("never fetches children when expanding a childless described node", () => {
    const getChildrenSpy = vi.spyOn(MockBridgeEngineClient.prototype, "getChildren");
    renderDescribedBlock();

    fireEvent.click(screen.getByText("Developer"));

    expect(screen.getByTestId("block")).toHaveAttribute("data-expand-state", "expanded");
    expect(getChildrenSpy).not.toHaveBeenCalled();
    getChildrenSpy.mockRestore();
  });

  it("appends the className prop to the root block element", () => {
    renderDescribedBlock("block-actor block-actor--person");
    expect(screen.getByTestId("block")).toHaveClass("block-actor--person");
  });
});

describe("Block copy button", () => {
  function stubClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    return writeText;
  }

  it("copies a folder's path without toggling the block's expand state", async () => {
    const writeText = stubClipboard();
    renderRoot();
    fireEvent.click(screen.getByText("examples"));
    await waitFor(() => screen.getByText("shadow-app"));

    fireEvent.click(screen.getByRole("button", { name: "Copy shadow-app" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("shadow-app"));
    expect(screen.getByText("shadow-app").closest('[data-testid="block"]')).toHaveAttribute(
      "data-expand-state",
      "collapsed",
    );
  });

  it("copies a file's full path but only the bare name of a function", async () => {
    const writeText = stubClipboard();
    renderRoot();
    await navigateToCalculateTotal();

    fireEvent.click(screen.getByRole("button", { name: "Copy order_service.py" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("shadow-app/backend/domain/order_service.py"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy calculate_total" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("calculate_total"));
  });

  it("flashes the failure glyph when the clipboard is unavailable", () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    renderRoot();

    fireEvent.click(screen.getByRole("button", { name: "Copy examples" }));

    expect(screen.getByRole("button", { name: "Copy examples" })).toHaveAttribute(
      "data-copy-state",
      "failed",
    );
  });
});

describe("Block selection", () => {
  it("stamps data-select-id (the marquee's own lookup key) only when selectable", () => {
    renderRoot(undefined, undefined, true);

    expect(screen.getByTestId("block")).toHaveAttribute("data-select-id", FIXTURE_NODES.root.node_id);
  });

  it("never stamps data-select-id for a non-selectable block (the default)", () => {
    renderRoot();

    expect(screen.getByTestId("block")).not.toHaveAttribute("data-select-id");
  });

  it("shift-clicking a selectable block selects it instead of expanding it", () => {
    renderRoot(undefined, undefined, true);

    fireEvent.click(screen.getByText(FIXTURE_NODES.root.name), { shiftKey: true });

    const block = screen.getByText(FIXTURE_NODES.root.name).closest('[data-testid="block"]');
    expect(block).toHaveAttribute("data-expand-state", "collapsed");
    expect(block).toHaveClass("block-selected");
    expect(selectionStore.isSelected(FIXTURE_NODES.root.node_id)).toBe(true);
  });

  it("ctrl/cmd-clicking a selected selectable block deselects it", () => {
    renderRoot(undefined, undefined, true);
    fireEvent.click(screen.getByText(FIXTURE_NODES.root.name), { shiftKey: true });

    fireEvent.click(screen.getByText(FIXTURE_NODES.root.name), { metaKey: true });

    expect(selectionStore.isSelected(FIXTURE_NODES.root.node_id)).toBe(false);
    expect(
      screen.getByText(FIXTURE_NODES.root.name).closest('[data-testid="block"]'),
    ).not.toHaveClass("block-selected");
  });

  it("a plain click clears an existing selection and still runs its normal action", () => {
    renderRoot();
    selectionStore.replace(["some-other-node"]);

    fireEvent.click(screen.getByText(FIXTURE_NODES.root.name));

    expect(selectionStore.getSelectedIds()).toEqual([]);
    expect(
      screen.getByText(FIXTURE_NODES.root.name).closest('[data-testid="block"]'),
    ).toHaveAttribute("data-expand-state", "expanded");
  });

  it("a non-selectable block (the default) never joins selectionStore on shift-click, and expands instead", () => {
    renderRoot();

    fireEvent.click(screen.getByText(FIXTURE_NODES.root.name), { shiftKey: true });

    expect(selectionStore.isSelected(FIXTURE_NODES.root.node_id)).toBe(false);
    const block = screen.getByText(FIXTURE_NODES.root.name).closest('[data-testid="block"]');
    expect(block).not.toHaveClass("block-selected");
    expect(block).toHaveAttribute("data-expand-state", "expanded");
  });
});

describe("Block ChildRenderer", () => {
  it("hands its children to the supplied renderer and stacks them instead of gridding them", async () => {
    render(
      <EngineClientProvider repoId="default" client={new MockBridgeEngineClient()}>
        <CanvasFocusContext.Provider value={() => {}}>
          <CodePopupContext.Provider value={() => {}}>
            <Block node={FIXTURE_NODES.root} ChildRenderer={TreeNode} />
          </CodePopupContext.Provider>
        </CanvasFocusContext.Provider>
      </EngineClientProvider>,
    );

    fireEvent.click(screen.getByText(FIXTURE_NODES.root.name));

    await waitFor(() => expect(screen.getByText("shadow-app")).toBeInTheDocument());
    expect(screen.getByText("shadow-app").closest('[data-testid="tree-node"]')).not.toBeNull();
    expect(screen.getByTestId("block-children")).toHaveClass("block-children-tree");
    expect(screen.getByTestId("block-children").style.getPropertyValue("--block-child-columns")).toBe(
      "",
    );
  });
});
