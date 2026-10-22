import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { UsageStrip, compactTokens } from "./UsageStrip";
import type { AgentUsage } from "../agentClient";
import { ActivityPanel } from "../ActivityPanel";
import { agentStore } from "../agentStore";
import { AgentClientProvider } from "../AgentClientContext";
import { MockAgentClient } from "../mockAgentClient";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { MockBridgeEngineClient } from "../../engine-client/mockBridge";
import { layoutStore } from "../../canvas/layout/layoutStore";
import { workflowStore } from "../../workflows/workflowStore";

vi.mock("../AgentTerminal", () => ({
  AgentTerminal: ({ workspace }: { workspace: string }) => <div data-testid={`terminal-${workspace}`} />,
}));
vi.mock("../../workflows/WorkflowsTab", () => ({ WorkflowsTab: () => null }));

const usage: AgentUsage = {
  contextTokens: 62_000,
  contextWindow: 200_000,
  inputTokens: 184_000,
  outputTokens: 12_000,
  cacheReadTokens: 143_520,
  cacheHitRatio: 0.78,
  costUsd: 0.84,
};

beforeEach(() => {
  agentStore.reset();
  layoutStore.reset();
  workflowStore.reset();
});
afterEach(cleanup);

describe("UsageStrip", () => {
  it("shows context, tokens, cache hit and cost with a context meter", () => {
    render(<UsageStrip usage={usage} />);

    const strip = screen.getByTestId("agent-usage-strip");
    expect(strip).toHaveTextContent("Context62k / 200k · 31%");
    expect(strip).toHaveTextContent("Tokens184k in · 12k out");
    expect(strip).toHaveTextContent("Cache hit78%");
    expect(strip).toHaveTextContent("Cost$0.84");
    const meter = screen.getByRole("meter", { name: "Context used" });
    expect(meter).toHaveAttribute("aria-valuenow", "62000");
    expect(meter).toHaveAttribute("aria-valuemax", "200000");
  });

  it("hides the cost when the model has no price", () => {
    render(<UsageStrip usage={{ ...usage, costUsd: null }} />);

    expect(screen.getByTestId("agent-usage-strip")).not.toHaveTextContent("Cost");
  });

  it.each([
    [950, "950"],
    [184_000, "184k"],
    [1_200_000, "1.2M"],
  ])("compacts %d tokens to %s", (tokens, text) => {
    expect(compactTokens(tokens)).toBe(text);
  });

  it("puts the strip in the selected agent's full-screen header beside a left agent list", async () => {
    const client = new MockAgentClient();
    const agent = await client.create("Planner");
    const started = await client.start(agent.id);
    const withUsage = Object.assign(client, { usage: vi.fn().mockResolvedValue(usage) });
    agentStore.upsert(started);
    layoutStore.setAgentsMode("full");
    render(
      <AgentClientProvider client={withUsage}>
        <EngineClientProvider repoId="main" client={new MockBridgeEngineClient()}>
          <ActivityPanel onRunAgent={() => {}} />
        </EngineClientProvider>
      </AgentClientProvider>,
    );

    const header = (await screen.findByTestId("agent-usage-strip")).parentElement!;
    expect(within(header).getByRole("button", { name: "Stop agent" })).toBeVisible();
    expect(within(screen.getByRole("navigation", { name: "Agents" })).getByText("Planner")).toBeVisible();
    expect(withUsage.usage).toHaveBeenCalledWith(agent.id);
  });
});
