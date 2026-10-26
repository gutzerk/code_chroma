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

function say(text: string) {
  fireEvent.change(screen.getByTestId("chat-input"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("chat-send"));
}

describe("RunChat", () => {
  beforeEach(() => workflowStore.reset());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("sends every message to the run agent and offers no step picker", async () => {
    const client = setup();
    await startRun(client);
    const spy = vi.spyOn(client, "sendRunMessage");

    say("@implement hello");

    await waitFor(() => expect(spy).toHaveBeenCalledWith("run1", "run", "@implement hello"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("chat-picker")).toBeNull();
  });

  it("asking while running does not change run or step state", async () => {
    const client = setup();
    await startRun(client);

    say("how is it going?");

    await waitFor(() => expect(screen.getAllByText(/Run is running/)).toHaveLength(1));
    expect(screen.getByTestId("run-state")).toHaveTextContent("Running");
    const run = client.workflowEngine.getRun("run1");
    expect(run.state).toBe("running");
    expect(run.steps[0].status).toBe("running");
  });

  it("collapses the rail on input focus and reopens it on click", async () => {
    const client = setup();
    await startRun(client);

    fireEvent.focus(screen.getByTestId("chat-input"));

    expect(screen.queryByTestId("step-rail")).toBeNull();
    const line = screen.getByTestId("step-rail-collapsed");
    expect(line).toHaveTextContent("plan");
    fireEvent.click(line);
    expect(screen.getByTestId("step-rail")).toBeInTheDocument();
  });

  it("collapses the rail on send too", async () => {
    const client = setup();
    await startRun(client);

    say("status?");

    expect(await screen.findByTestId("step-rail-collapsed")).toBeInTheDocument();
  });

  it("renders system events inline and rings the canvas node for a chip link", async () => {
    const client = setup();
    await startRun(client);
    const node = document.createElement("div");
    node.setAttribute("data-node-id", "fn:hello");
    document.body.appendChild(node);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(screen.getByTestId("chat-system")).toHaveTextContent("Run paused"));
    say("where?");

    fireEvent.click(await screen.findByRole("button", { name: "Show hello() on canvas" }));

    await waitFor(() => expect(node.classList.contains("workflow-canvas-ring")).toBe(true));
    await waitFor(() => expect(node.classList.contains("workflow-canvas-ring")).toBe(false), {
      timeout: 3000,
    });
    node.remove();
    expect(client.workflowEngine.getRun("run1").state).toBe("paused");
  });

  it("sends the Send-back note with the review decision", async () => {
    const client = setup();
    await startRun(client);
    act(() => client.workflowEngine.advance("run1"));
    act(() => client.workflowEngine.advance("run1"));
    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Needs you"));
    fireEvent.click(screen.getByRole("button", { name: "review, Needs you" }));

    fireEvent.change(screen.getByTestId("sendback-note-review"), { target: { value: "tighten tests" } });
    fireEvent.click(screen.getByRole("button", { name: "Send back: review" }));

    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Running"));
    expect(client.workflowEngine.getRun("run1").steps[2].output).toContain("Sent back: tighten tests");
  });
});
