import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  WorkflowsTab: () => <button type="button">Run workflow</button>,
}));
describe("ActivityPanel", () => {
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
  it("stretches and goes full screen from the switcher row", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Stretch panel" }));
    expect(layoutStore.getState().agentsWidth).toBe("wide");
    fireEvent.click(screen.getByRole("button", { name: "Restore panel width" }));
    expect(layoutStore.getState().agentsWidth).toBe("default");
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));

    expect(layoutStore.getState().agentsMode).toBe("full");
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
});
