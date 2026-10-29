import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EngineClient } from "../../engine-client/EngineClient";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { IMPACT_CHANGES_STUB } from "../../engine-client/stubEngineClient";
import { AgentClientProvider } from "../../agents/AgentClientContext";
import type { AgentClient } from "../../agents/agentClient";
import { PR_CLIENT_STUB } from "../../agents/stubAgentClient";
import type { CanvasElement } from "../../state/types";
import { canvasDocStore } from "../doc/canvasDocStore";
import { collapsedLayersStore } from "../doc/collapsedLayersStore";
import { layoutStore } from "../layout/layoutStore";
import { diagramSelectionStore } from "./diagramSelectionStore";
import { LeftPanel } from "./LeftPanel";

function el(id: string, layer: string): CanvasElement {
  return {
    id,
    render: "c1",
    layer,
    label: id,
    description: "",
    node_id: null,
    position: { x: 0, y: 0 },
    size: null,
    group_id: null,
    meta: {},
    created_by: "ai",
  };
}

function renderPanel(arrange?: ReactNode) {
  return render(
    <EngineClientProvider repoId="main" client={IMPACT_CHANGES_STUB as unknown as EngineClient}>
      <AgentClientProvider client={PR_CLIENT_STUB as unknown as AgentClient}>
        <LeftPanel rootNode={null} onActivate={() => {}} arrange={arrange} />
      </AgentClientProvider>
    </EngineClientProvider>,
  );
}

beforeEach(() => {
  canvasDocStore.reset();
  collapsedLayersStore.reset();
  diagramSelectionStore.reset();
  layoutStore.reset();
  canvasDocStore.setDoc({
    ...canvasDocStore.getDoc(),
    elements: { a: el("a", "c1"), b: el("b", "c1"), p: el("p", "patterns") },
  });
});
afterEach(cleanup);

describe("LeftPanel", () => {
  it("lists one row per diagram on the Diagrams tab by default", () => {
    renderPanel();

    expect(screen.getByRole("tab", { name: "Diagrams" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("ON CANVAS · 2")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("toggles selection through the checkbox", () => {
    renderPanel();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(diagramSelectionStore.getSelected()).toHaveLength(1);
  });

  it("hides a diagram with the eye button and offers Show afterwards", () => {
    renderPanel();
    const hide = screen.getAllByRole("button", { name: /^Hide / })[0];

    fireEvent.click(hide);

    expect(collapsedLayersStore.getCollapsed().size).toBe(1);
    expect(screen.getAllByRole("button", { name: /^Show / })).toHaveLength(1);
  });

  it("switches to the Files tab", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("tab", { name: "Files" }));

    expect(layoutStore.getState().leftTab).toBe("files");
    expect(screen.getByTestId("left-panel-files")).toBeInTheDocument();
  });

  it("closes through the edge handle", () => {
    renderPanel();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Collapse diagrams panel" }));
    });

    expect(layoutStore.getState().leftOpen).toBe(false);
  });

  it("names a titled diagram by its title and keeps the type as a small label", () => {
    const titled = { ...el("s", "sequence"), meta: { diagram_title: "How a file save reaches the canvas" } };
    canvasDocStore.setDoc({ ...canvasDocStore.getDoc(), elements: { s: titled, p: el("p", "patterns") } });

    renderPanel();

    expect(screen.getByText("How a file save reaches the canvas")).toBeInTheDocument();
    expect(screen.getByTestId("left-panel-row-type-sequence")).toHaveTextContent("SEQUENCE ·");
    expect(screen.queryByTestId("left-panel-row-type-patterns")).toBeNull();
  });

  it("renders the arrange node passed in", () => {
    renderPanel(<div data-testid="arrange-stub" />);

    expect(screen.getByTestId("arrange-stub")).toBeInTheDocument();
  });
});
