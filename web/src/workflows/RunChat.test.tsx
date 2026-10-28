import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MockBridgeEngineClient } from "../engine-client/mockBridge";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { WorkflowsTab } from "./WorkflowsTab";
import { workflowActions, workflowStore } from "./workflowStore";

function setup() {
  const client = new MockBridgeEngineClient();
  client.workflowEngine.stepMs = 0;
  render(
    <EngineClientProvider repoId="default" client={client}>
      <WorkflowsTab />
    </EngineClientProvider>,
  );
  return client;
}

async function startRun(client: MockBridgeEngineClient) {
  await waitFor(() => expect(workflowStore.getWorkflows()).toHaveLength(1));
  await act(async () => {
    await workflowActions(client).start("ship-feature");
  });
  await screen.findByTestId("step-rail");
}

describe("RunChat", () => {
  beforeEach(() => workflowStore.reset());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders system events inline and rings the canvas node for a chip link", async () => {
    const client = setup();
    await startRun(client);
    const node = document.createElement("div");
    node.setAttribute("data-node-id", "fn:hello");
    document.body.appendChild(node);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(screen.getByTestId("chat-system")).toHaveTextContent("Run paused"));
    await act(async () => {
      await workflowActions(client).message("run1", "run", "where?");
    });

    fireEvent.click(await screen.findByRole("button", { name: "Show hello() on canvas" }));

    await waitFor(() => expect(node.classList.contains("workflow-canvas-ring")).toBe(true));
    await waitFor(() => expect(node.classList.contains("workflow-canvas-ring")).toBe(false), {
      timeout: 3000,
    });
    node.remove();
    expect(client.workflowEngine.getRun("run1").state).toBe("paused");
  });

  it("opens the step waiting on you by default and lets you close it", async () => {
    const client = setup();
    await startRun(client);
    act(() => client.workflowEngine.advance("run1"));
    act(() => client.workflowEngine.advance("run1"));
    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Needs you"));

    const row = screen.getByRole("button", { name: "review, Needs you" });
    expect(row).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(row);

    expect(screen.getByRole("button", { name: "review, Needs you" })).toHaveAttribute("aria-expanded", "false");
  });

  it("moves the open row to the step that starts waiting on you", async () => {
    const client = setup();
    await startRun(client);
    fireEvent.click(screen.getByRole("button", { name: "plan, Running" }));
    act(() => client.workflowEngine.advance("run1"));
    act(() => client.workflowEngine.advance("run1"));

    await waitFor(() => expect(screen.getByRole("button", { name: "review, Needs you" })).toHaveAttribute("aria-expanded", "true"));
  });

  it("sends the Send-back note with the review decision", async () => {
    const client = setup();
    await startRun(client);
    act(() => client.workflowEngine.advance("run1"));
    act(() => client.workflowEngine.advance("run1"));
    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Needs you"));

    fireEvent.change(screen.getByTestId("sendback-note-review"), { target: { value: "tighten tests" } });
    fireEvent.click(screen.getByRole("button", { name: "Send back: review" }));

    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Running"));
    expect(client.workflowEngine.getRun("run1").steps[2].output).toContain("Sent back: tighten tests");
  });
});
