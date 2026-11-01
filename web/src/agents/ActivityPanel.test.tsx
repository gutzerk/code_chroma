import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ActivityPanel } from "./ActivityPanel";
import { agentStore } from "./agentStore";
import { AgentClientProvider } from "./AgentClientContext";
import { MockAgentClient } from "./mockAgentClient";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { MockBridgeEngineClient } from "../engine-client/mockBridge";
import { layoutStore } from "../canvas/layout/layoutStore";
import { workflowStore } from "../workflows/workflowStore";

vi.mock("./AgentTerminal", () => ({
  AgentTerminal: ({ workspace }: { workspace: string }) => (
    <div data-testid={`terminal-${workspace}`} />
  ),
}));
function setup(client = new MockBridgeEngineClient()) {
  client.workflowEngine.stepMs = 0;
  render(
    <AgentClientProvider client={new MockAgentClient()}>
      <EngineClientProvider repoId="main" client={client}>
        <ActivityPanel onRunAgent={() => {}} />
      </EngineClientProvider>
    </AgentClientProvider>,
  );
  return client;
}
beforeEach(() => {
  agentStore.reset();
  layoutStore.reset();
  workflowStore.reset();
});
afterEach(cleanup);
vi.mock("../workflows/WorkflowsTab", () => ({
  WorkflowsTab: () => <div data-testid="workflows-tab-stub" />,
}));
describe("ActivityPanel", () => {
  it("opens on the Workflows tab when unfinished runs come back and there are no agents", () => {
    setup();
    act(() => layoutStore.setAgentsMode("collapsed"));
    const run = { id: "r1", workflowId: "w", state: "stopped", currentStepId: null, stopAfter: null, attempt: 1, attempts: [], breakpoints: [], steps: [] };

    act(() => workflowStore.setRuns([run] as never));

    expect(layoutStore.getState().agentsMode).toBe("normal");
    expect(screen.getByRole("tab", { name: /Workflows/ })).toHaveAttribute("aria-selected", "true");
  });

  it.each(["ctrlKey", "metaKey"])("cycles agents in both directions with %s+Alt+arrows", async (modifier) => {
    const client = new MockAgentClient();
    const first = await client.create("Planner");
    const second = await client.create("Builder");
    agentStore.upsert(first);
    agentStore.upsert(second);
    setup();
    fireEvent.click(screen.getByRole("tab", { name: /Workflows/ }));
    act(() => layoutStore.setAgentsMode("collapsed"));

    fireEvent.keyDown(window, { key: "ArrowDown", [modifier]: true, altKey: true });
    expect(layoutStore.getState()).toMatchObject({ selectedAgentId: second.id, agentsMode: "normal" });
    expect(screen.getByRole("tab", { name: /Agents/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId(`terminal-${second.id}`)).toBeVisible();

    fireEvent.keyDown(window, { key: "ArrowDown", [modifier]: true, altKey: true });
    expect(layoutStore.getState().selectedAgentId).toBe(first.id);
    act(() => layoutStore.setAgentsMode("full"));
    fireEvent.keyDown(window, { key: "ArrowUp", [modifier]: true, altKey: true });
    expect(layoutStore.getState()).toMatchObject({ selectedAgentId: second.id, agentsMode: "full" });
  });

  it("leaves unmodified arrows and modal keyboard input alone", async () => {
    const agent = await new MockAgentClient().create("Planner");
    agentStore.upsert(agent);
    setup();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(layoutStore.getState().selectedAgentId).toBeNull();
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    fireEvent.keyDown(window, { key: "ArrowDown", ctrlKey: true, altKey: true });
    modal.remove();
    expect(layoutStore.getState().selectedAgentId).toBeNull();
  });

  it("keeps the header and switcher row on the agents tab only for run agent", () => {
    setup();

    expect(screen.getByRole("button", { name: "Run agent" })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Agents/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /Workflows/ }));

    expect(screen.getByRole("button", { name: "Run workflow" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run agent" })).toBeNull();
  });
  it("preserves terminal elements across tabs and collapse without floating windows", async () => {
    const agent = await new MockAgentClient().create("Planner");
    agentStore.upsert(agent);
    setup();
    const terminal = screen.getByTestId(`terminal-${agent.id}`);
    fireEvent.click(screen.getByRole("tab", { name: /Workflows/ }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse agents and workflows" }));
    expect(screen.getByTestId(`terminal-${agent.id}`)).toBe(terminal);
    fireEvent.click(screen.getByRole("button", { name: "Expand agents and workflows" }));
    fireEvent.click(screen.getByRole("tab", { name: /Agents/ }));
    expect(terminal).toBeVisible();
    expect(screen.queryByTestId(`agent-window-${agent.id}`)).toBeNull();
    expect(screen.queryByRole("button", { name: /Detach/ })).toBeNull();
  });
  it("selects an agent from the dropdown", async () => {
    const client = new MockAgentClient();
    agentStore.upsert(await client.create("Planner"));
    agentStore.upsert(await client.create("Builder"));
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Select agent" }));
    fireEvent.click(screen.getByRole("option", { name: /Builder/ }));

    expect(layoutStore.getState().selectedAgentId).toBe(agentStore.getAgents()[1].id);
  });
  it("shows Exit full screen after the edge Stretch arrow is pressed", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Stretch panel" }));

    expect(layoutStore.getState().agentsMode).toBe("full");
    expect(screen.getByRole("button", { name: "Exit full screen" })).toBeTruthy();
  });
  it("shows Restore panel width after the header Full screen button is pressed", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));

    expect(screen.getByRole("button", { name: "Restore panel width" })).toBeTruthy();
  });
  it("leaves full screen when the grip is dragged right, keeping the dragged width", () => {
    setup();
    act(() => layoutStore.setAgentsMode("full"));
    const panel = screen.getByTestId("activity-panel");
    panel.getBoundingClientRect = () => ({ width: 1000, height: 600, left: 0, top: 0, right: 1000, bottom: 600, x: 0, y: 0 }) as DOMRect;
    const grip = panel.querySelector<HTMLElement>(".panel-handle-grip")!;
    grip.setPointerCapture = () => {};

    fireEvent.pointerMove(grip, { pointerId: 1, buttons: 0, clientX: 900 });
    const hoverMode = layoutStore.getState().agentsMode;
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, buttons: 1, clientX: 100 });
    fireEvent.pointerMove(grip, { pointerId: 1, buttons: 1, clientX: 180 });

    expect(hoverMode).toBe("full");
    expect(layoutStore.getState().agentsMode).toBe("normal");
    expect(panel.style.width).not.toBe("");
  });
  it("collapses from the edge handle", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Collapse panel" }));

    expect(layoutStore.getState().agentsMode).toBe("collapsed");
  });
  it("shows how many agents there are on the dropdown trigger", async () => {
    agentStore.upsert(await new MockAgentClient().create("Planner"));
    agentStore.upsert(await new MockAgentClient().create("Builder"));
    setup();

    expect(screen.getByTestId("agent-count")).toHaveTextContent("1/2");
  });
  it("lists agents in a left column in full screen and keeps full screen when switching", async () => {
    agentStore.upsert(await new MockAgentClient().create("Planner"));
    agentStore.upsert(await new MockAgentClient().create("Builder"));
    layoutStore.setAgentsMode("full");
    setup();

    const list = screen.getByRole("navigation", { name: "Agents" });
    fireEvent.click(within(list).getByRole("button", { name: /Builder/ }));

    expect(screen.queryByRole("button", { name: "Select agent" })).toBeNull();
    expect(within(list).getAllByRole("button", { name: /Planner|Builder/ })).toHaveLength(2);
    expect(layoutStore.getState().agentsMode).toBe("full");
    expect(layoutStore.getState().selectedAgentId).toBe(agentStore.getAgents()[1].id);
  });
  it("collapses to a strip with counts and a per-agent avatar that reopens it", async () => {
    const agent = await new MockAgentClient().create("Planner Bot");
    agentStore.upsert(agent);
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Collapse agents and workflows" }));
    expect(screen.getByTestId("strip-agents-count")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: /Open Planner Bot/ }));

    expect(layoutStore.getState()).toMatchObject({ agentsMode: "normal", selectedAgentId: agent.id });
  });
  it("highlights only the agents launched to draw a diagram", async () => {
    const drawing = await new MockAgentClient().create("Drawer");
    const plain = await new MockAgentClient().create("Planner");
    agentStore.upsert({ ...drawing, context_kind: "task" });
    agentStore.upsert(plain);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Select agent" }));
    const menu = screen.getByRole("listbox", { name: "Agents" });
    expect(menu.querySelectorAll("[data-diagram]")).toHaveLength(1);
    expect(menu.querySelectorAll(".activity-agent-badge")).toHaveLength(1);
  });
});
