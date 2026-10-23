import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("WorkflowsTab run detail", () => {
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

    fireEvent.click(screen.getByTestId("header-toggle"));

    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Paused"));
    expect(screen.getByTestId("run-banner")).toHaveTextContent("Paused at plan");
    fireEvent.click(screen.getByTestId("header-toggle"));
    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Running"));
  });

  it("cancels the run and offers Resume from here on the stopped step", async () => {
    const client = setup();
    await startRun(client);

    fireEvent.click(screen.getByTestId("cancel-run"));

    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Stopped"));
    expect(screen.queryByTestId("cancel-run")).toBeNull();
    expect(screen.getByTestId("delete-run")).toBeEnabled();
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
    expect(screen.getByTestId("header-toggle")).toHaveTextContent("Continue");
    fireEvent.click(screen.getByTestId("header-toggle"));
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
    expect(document.body.textContent).not.toMatch(/[▶✓✦☐⏸]/);
    for (const button of buttons) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.tabIndex).toBe(0);
    }
    const stop = screen.getByTestId("cancel-run");
    stop.focus();
    expect(document.activeElement).toBe(stop);
  });

  it("labels the context between steps", async () => {
    const client = setup();
    await startRun(client);

    expect(screen.queryByTestId("between-plan")).toBeNull();
    expect(screen.getByTestId("between-implement")).toHaveTextContent("Passes plan output to step 2");
    expect(screen.getByTestId("between-review")).toHaveTextContent("You review the diff from step 2");
  });

  it("lists the run under Active with its step position", async () => {
    const client = setup();
    await startRun(client);
    fireEvent.click(screen.getByRole("button", { name: "All workflow runs" }));

    expect(screen.getByRole("heading", { name: "Active · 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open run run1 (Running)" })).toHaveTextContent("Running · step 1 of 4");
    expect(screen.queryByTestId("saved-ship-feature")).toBeNull();
  });

  it("shows saved workflows only on the All workflows screen, with Edit, Run and the actions menu", async () => {
    const client = setup();
    await startRun(client);

    act(() => workflowStore.setView("all"));

    const row = screen.getByTestId("saved-ship-feature");
    expect(within(row).getByText("4 steps · 3 agent · 1 you")).toBeInTheDocument();
    expect(within(row).getByText("review · you")).toBeInTheDocument();
    expect(within(row).getByText("Running now")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Edit workflow Ship a feature" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Run Ship a feature" })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "More actions for Ship a feature" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Duplicate", "Rename", "Delete"]);
    fireEvent.click(screen.getByTestId("all-back"));
    expect(screen.queryByTestId("all-workflows")).toBeNull();
    expect(screen.getByTestId("workflow-screen")).toBeInTheDocument();
  });

  it("filters All workflows by the search text", async () => {
    const client = setup();
    await startRun(client);
    act(() => workflowStore.setView("all"));

    fireEvent.change(screen.getByPlaceholderText("Search workflows"), { target: { value: "zzz" } });

    expect(screen.queryByTestId("saved-ship-feature")).toBeNull();
    expect(screen.getByText("No workflow matches the search.")).toBeInTheDocument();
  });

  it("duplicates a workflow from the actions menu", async () => {
    const client = setup();
    await startRun(client);
    act(() => workflowStore.setView("all"));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Ship a feature" }));

    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    await waitFor(() => expect(workflowStore.getWorkflows().map((w) => w.name)).toContain("Ship a feature copy"));
  });

  it("restarts a finished run only after confirming", async () => {
    const client = setup();
    await startRun(client);
    fireEvent.click(screen.getByTestId("cancel-run"));
    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Stopped"));

    fireEvent.click(screen.getByTestId("restart-run"));
    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-yes"));

    await waitFor(() => expect(screen.getByTestId("run-state")).toHaveTextContent("Running"));
  });
});

describe("WorkflowsTab responsive layout", () => {
  let observe: ((width: number) => void) | null = null;
  beforeEach(() => {
    workflowStore.reset();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: (entries: { contentRect: { width: number } }[]) => void) {
          observe = (width) => cb([{ contentRect: { width } }]);
        }
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("collapses secondary actions into a menu at 320px and below", async () => {
    const client = setup();
    await startRun(client);

    act(() => observe?.(300));

    expect(screen.getByTestId("workflows-tab")).toHaveAttribute("data-layout", "narrow");
    expect(screen.queryByTestId("stop-after")).toBeNull();
    fireEvent.click(screen.getByTestId("overflow-menu"));
    expect(screen.getByRole("menuitem", { name: "Cancel run" })).toBeInTheDocument();
  });

  it("shows the run list beside the detail at 640px and wider", async () => {
    const client = setup();
    await startRun(client);

    act(() => observe?.(700));

    expect(screen.getByTestId("workflows-tab")).toHaveAttribute("data-layout", "side");
    expect(screen.getByTestId("run-overview")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("live-view")).toBeNull();
  });

  it("leaves Run workflow, All workflows and Full screen to the activity header", async () => {
    setup();
    await waitFor(() => expect(workflowStore.getWorkflows()).toHaveLength(1));

    act(() => observe?.(760));

    expect(screen.queryByTestId("run-workflow")).toBeNull();
    expect(screen.queryByRole("button", { name: "All workflows" })).toBeNull();
  });

  it("adds the live Agent / Output / Diff view at 1100px and wider", async () => {
    const client = setup();
    await startRun(client);

    act(() => observe?.(1200));

    expect(screen.getByTestId("live-view")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("live-tab-diff"));
    expect(screen.getByTestId("live-tab-diff")).toHaveAttribute("aria-selected", "true");
  });
});
