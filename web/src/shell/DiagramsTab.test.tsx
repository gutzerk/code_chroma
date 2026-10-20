import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentClientProvider } from "../agents/AgentClientContext";
import { MockAgentClient } from "../agents/mockAgentClient";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { CANVAS_STUB } from "../engine-client/stubEngineClient";
import type { EngineClient } from "../engine-client/EngineClient";
import { canvasDocStore } from "../canvas/doc/canvasDocStore";
import { EMPTY_CANVAS_DOC, type CanvasElement } from "../state/types";
import { DiagramsTab } from "./DiagramsTab";
import { diagramSelectionStore } from "./diagramSelectionStore";
import { shellStore } from "./shellStore";
import { collapsedLayersStore } from "../canvas/doc/collapsedLayersStore";

function el(id: string, layer: string): CanvasElement {
  return {
    id, render: "custom", layer, label: id, description: "", node_id: null,
    position: { x: 0, y: 0 }, size: null, group_id: null, meta: {}, created_by: "ai",
  };
}

const client = {
  ...CANVAS_STUB,
  listDiagramTypes: async () => [],
  subscribeDiagram: () => () => {},
} as unknown as EngineClient;

function renderTab(props: Parameters<typeof DiagramsTab>[0] = {}) {
  canvasDocStore.setDoc({
    ...EMPTY_CANVAS_DOC,
    elements: Object.fromEntries([el("a", "c1"), el("b", "c1"), el("c", "patterns")].map((e) => [e.id, e])),
  });
  return render(
    <AgentClientProvider client={new MockAgentClient()}>
      <EngineClientProvider repoId="default" client={client}>
        <DiagramsTab {...props} />
      </EngineClientProvider>
    </AgentClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  canvasDocStore.reset();
  shellStore.reset();
  diagramSelectionStore.reset();
});

describe("DiagramsTab", () => {
  it("shows the count header and a row per diagram with type and box count", () => {
    renderTab();

    expect(screen.getByText("ON CANVAS · 2")).toBeInTheDocument();
    expect(screen.getByTestId("diagrams-tab-row-c1")).toHaveTextContent("c1 · 2 boxes");
    expect(screen.getByTestId("diagrams-tab-dot-c1")).toHaveStyle({ background: "var(--c1)" });
  });

  it("toggles hidden through the eye button and flips its label", () => {
    renderTab();

    fireEvent.click(screen.getByLabelText("Hide C1"));

    expect(collapsedLayersStore.isCollapsed("c1")).toBe(true);
    expect(screen.getByLabelText("Show C1")).toBeInTheDocument();
  });

  it("keeps ticked layers in the selection store", () => {
    renderTab();

    fireEvent.click(screen.getByLabelText("Select Design patterns"));

    expect(diagramSelectionStore.getSelected()).toEqual(["patterns"]);
  });

  it("opens the draw popover and renders the arrange slot", () => {
    renderTab({ arrangeSlot: <div data-testid="slot" /> });

    fireEvent.click(screen.getByTestId("diagrams-tab-draw"));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByTestId("slot")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting a diagram", () => {
    renderTab();

    fireEvent.click(screen.getByLabelText("More actions for C1"));
    fireEvent.click(screen.getByLabelText("Delete C1"));

    expect(screen.getByTestId("delete-diagram-dialog")).toBeInTheDocument();
  });
});
