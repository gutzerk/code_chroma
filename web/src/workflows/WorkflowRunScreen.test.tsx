import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MockBridgeEngineClient } from "../engine-client/mockBridge";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { WorkflowRunScreen } from "./WorkflowRunScreen";
import { workflowActions, workflowStore } from "./workflowStore";

function setup() {
  const client = new MockBridgeEngineClient();
  client.workflowEngine.stepMs = 0;
  render(
    <EngineClientProvider repoId="default" client={client}>
      <WorkflowRunScreen />
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

describe("WorkflowRunScreen", () => {
  beforeEach(() => workflowStore.reset());
  afterEach(cleanup);

  it("starts a run and shows steps with icon plus text status", async () => {
    const client = setup();

    await startRun(client);

    const row = screen.getByTestId("step-row-plan");
    expect(row).toHaveAttribute("data-status", "running");
    expect(within(row).getByText("Running")).toBeInTheDocument();
    expect(screen.getByTestId("step-row-implement")).toHaveAttribute("data-status", "pending");
  });

  it("puts the breakpoint gutter on unstarted steps only", async () => {
    const client = setup();
    await startRun(client);

    expect(screen.queryByRole("button", { name: "Breakpoint before plan" })).toBeNull();
    expect(screen.getByRole("button", { name: "Breakpoint before implement" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Breakpoint before ship" })).toBeInTheDocument();
  });

  it("keeps one row expanded at a time with aria-expanded", async () => {
    const client = setup();
    await startRun(client);
    const plan = screen.getByRole("button", { name: "plan, Running" });
    const implement = screen.getByRole("button", { name: "implement, Pending" });

    fireEvent.click(plan);
    fireEvent.click(implement);

    expect(plan).toHaveAttribute("aria-expanded", "false");
    expect(implement).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("group")).toHaveLength(1);
  });

  it("pauses and resumes from the header", async () => {
    const client = setup();
    await startRun(client);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Paused"));
    expect(screen.getByTestId("run-banner")).toHaveTextContent("Paused at plan");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Running"));
  });

  it("stops the run now and offers Resume from here on the stopped step", async () => {
    const client = setup();
    await startRun(client);

    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));

    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Stopped"));
    expect(screen.getByRole("button", { name: "Stop run" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "plan, Stopped" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume from here: plan" }));
    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Running"));
  });

  it("holds before a breakpoint step and Continue releases it", async () => {
    const client = setup();
    await startRun(client);
    fireEvent.click(screen.getByRole("button", { name: "Breakpoint before implement" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Breakpoint before implement" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    act(() => client.workflowEngine.advance("run1"));

    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Held"));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Running"));
  });

  it("re-fetches the run when a run event arrives from outside", async () => {
    const client = setup();
    await startRun(client);

    act(() => {
      client.workflowEngine.advance("run1");
    });

    await waitFor(() =>
      expect(screen.getByTestId("step-row-plan")).toHaveAttribute("data-status", "done"),
    );
  });

  it("gates a review step on Approve and Send back", async () => {
    const client = setup();
    await startRun(client);
    act(() => client.workflowEngine.advance("run1"));
    act(() => client.workflowEngine.advance("run1"));
    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Needs you"));

    fireEvent.click(screen.getByRole("button", { name: "review, Needs you" }));

    expect(screen.getByRole("button", { name: "Approve: review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send back: review" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve: review" }));
    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Running"));
  });

  it("makes every control a focusable native button", async () => {
    const client = setup();
    await startRun(client);
    fireEvent.click(screen.getByRole("button", { name: "plan, Running" }));

    const buttons = screen.getAllByRole("button");

    expect(buttons.length).toBeGreaterThan(5);
    for (const button of buttons) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.tabIndex).toBe(0);
    }
    const stop = screen.getByRole("button", { name: "Stop run" });
    stop.focus();
    expect(document.activeElement).toBe(stop);
  });
});
