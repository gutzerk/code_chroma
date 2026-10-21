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

async function openRedo(client: MockBridgeEngineClient) {
  await waitFor(() => expect(workflowStore.getWorkflows()).toHaveLength(1));
  await act(async () => {
    await workflowActions(client).start("ship-feature");
  });
  await screen.findByTestId("step-rail");
  act(() => client.workflowEngine.advance("run1"));
  act(() => client.workflowEngine.advance("run1"));
  await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Needs you"));
  fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "please redo implement" } });
  fireEvent.click(screen.getByTestId("chat-send"));
  return screen.findByTestId("redo-card");
}

describe("RedoCard", () => {
  beforeEach(() => workflowStore.reset());
  afterEach(cleanup);

  it("shows the proposal with Reruns, Keeps and Sets aside", async () => {
    const client = setup();

    const card = await openRedo(client);

    expect(screen.getByTestId("run-state")).toHaveTextContent("Stopped");
    expect(within(card).getByTestId("redo-picker")).toHaveValue("s2");
    expect(within(card).getByTestId("redo-reruns")).toHaveTextContent("implement, review, ship");
    expect(within(card).getByTestId("redo-keeps")).toHaveTextContent("plan");
    expect(within(card).getByTestId("redo-sets-aside")).toHaveTextContent("implement, review");
    expect(within(card).queryByTestId("redo-warning")).toBeNull();
  });

  it("recomputes and warns in amber when the pick is later than suggested", async () => {
    const card = await openRedo(setup());

    fireEvent.change(within(card).getByTestId("redo-picker"), { target: { value: "s3" } });

    expect(within(card).getByTestId("redo-reruns")).toHaveTextContent("review, ship");
    expect(within(card).getByTestId("redo-keeps")).toHaveTextContent("plan, implement");
    expect(within(card).getByTestId("redo-warning")).toHaveTextContent("Later than suggested");
    expect(screen.getByTestId("will-rerun-review")).toBeInTheDocument();
    expect(screen.queryByTestId("will-rerun-implement")).toBeNull();
  });

  it("does not warn for an earlier pick", async () => {
    const card = await openRedo(setup());

    fireEvent.change(within(card).getByTestId("redo-picker"), { target: { value: "s1" } });

    expect(within(card).queryByTestId("redo-warning")).toBeNull();
    expect(within(card).getByTestId("redo-keeps")).toHaveTextContent("none");
  });

  it("Cancel clears the card and leaves the run stopped", async () => {
    const client = setup();
    const card = await openRedo(client);

    fireEvent.click(within(card).getByTestId("redo-cancel"));

    await waitFor(() => expect(screen.queryByTestId("redo-card")).toBeNull());
    expect(screen.getByTestId("run-state")).toHaveTextContent("Stopped");
    expect(client.workflowEngine.getRun("run1").attempt).toBe(1);
  });

  it("confirms with a note and an edited prompt saved to the workflow, starting attempt 2", async () => {
    const client = setup();
    const card = await openRedo(client);
    fireEvent.change(within(card).getByTestId("redo-note"), { target: { value: "use a map" } });
    fireEvent.click(within(card).getByTestId("redo-edit-first"));
    fireEvent.change(within(card).getByTestId("redo-prompt"), { target: { value: "Implement with a map." } });
    fireEvent.click(within(card).getByTestId("redo-save-workflow"));

    fireEvent.click(within(card).getByTestId("redo-confirm"));

    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Running"));
    const run = client.workflowEngine.getRun("run1");
    expect(run.attempt).toBe(2);
    expect(run.attempts.map((a) => ({ n: a.n, branch: a.branch }))).toEqual([
      { n: 1, branch: "run1/attempt-1" },
      { n: 2, branch: null },
    ]);
    expect(run.attempts[0].steps).toHaveLength(4);
    expect(run.steps.every((s) => s.attempt === 2)).toBe(true);
    expect(client.workflowEngine.listWorkflows()[0].steps[1].prompt).toBe("Implement with a map.");
    expect(screen.getByTestId("kept-plan")).toHaveTextContent("from attempt 1");
    expect(screen.queryByTestId("kept-implement")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "implement, Running" }));
    expect(screen.getByTestId("step-output")).toHaveTextContent("Note: use a map");
  });

  it("switches to attempt 1 read-only and back", async () => {
    const client = setup();
    const card = await openRedo(client);
    fireEvent.click(within(card).getByTestId("redo-confirm"));
    await waitFor(() => expect(screen.getByTestId("attempt-switcher")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("attempt-1"));

    expect(screen.getByTestId("attempt-readonly")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Breakpoint before/ })).toBeNull();
    expect(screen.queryByTestId("kept-plan")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "implement, Done" }));
    expect(screen.getByText("No actions right now.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("attempt-2"));
    expect(screen.queryByTestId("attempt-readonly")).toBeNull();
  });

  it("lists runs and attempts in the overview", async () => {
    const client = setup();
    const card = await openRedo(client);
    fireEvent.click(within(card).getByTestId("redo-confirm"));
    await waitFor(() => expect(screen.getByTestId("attempt-switcher")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "← All workflow runs" }));

    expect(screen.getByTestId("run-attempt-run1-1")).toHaveTextContent("set aside on run1/attempt-1");
    expect(screen.getByTestId("run-attempt-run1-2")).toHaveTextContent("current");
  });
});
