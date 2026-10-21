import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
describe("ActivityPanel", () => {
  it("keeps an empty panel open and puts launch actions only on their related tab", async () => {
    setup();
    expect(screen.getByRole("button", { name: /Run agent/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Run workflow/ })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Workflows/ }));
    expect(await screen.findByRole("button", { name: /Run workflow/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Run agent/ })).toBeNull();
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
  it("highlights only the agents launched to draw a diagram", async () => {
    const drawing = await new MockAgentClient().create("Drawer");
    const plain = await new MockAgentClient().create("Planner");
    agentStore.upsert({ ...drawing, context_kind: "task" });
    agentStore.upsert(plain);
    setup();
    const tabs = screen.getByRole("tablist", { name: "Running agents" });
    expect(tabs.querySelectorAll("[data-diagram]")).toHaveLength(1);
    expect(tabs.querySelectorAll(".activity-agent-badge")).toHaveLength(1);
  });
  it("creates a workflow from the empty state and makes it available to run", async () => {
    const client = new MockBridgeEngineClient();
    vi.spyOn(client, "listWorkflows").mockResolvedValueOnce([]);
    setup(client);
    fireEvent.click(screen.getByRole("tab", { name: /Workflows/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Run workflow/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My workflow" } });
    fireEvent.change(screen.getByLabelText("Instructions"), {
      target: { value: "Inspect this repository" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save workflow" })));
    expect(await screen.findByRole("button", { name: "Start run: My workflow" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Start run: My workflow" }));
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuemax", "1");
    fireEvent.click(screen.getByRole("button", { name: /Hide steps/ }));
    expect(screen.getByRole("progressbar")).toBeVisible();
  });
});
