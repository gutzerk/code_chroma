import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AgentClient } from "../agents/agentClient";
import { AgentClientProvider } from "../agents/AgentClientContext";
import { agentStore } from "../agents/agentStore";
import type { AgentRecord } from "../state/types";
import { StepTerminal } from "./StepTerminal";
import type { StepRecord } from "./types";

vi.mock("../agents/AgentTerminal", () => ({
  AgentTerminal: ({ workspace, running }: { workspace: string; running: boolean }) => (
    <div data-testid={`terminal-${workspace}`} data-running={String(running)} />
  ),
}));

const step: StepRecord = { stepId: "s2", attempt: 1, status: "done", output: "", diffStat: null, checkpointRef: null, sessionId: "sess-1" };

function record(): AgentRecord {
  return { id: "a1", title: "implement run1", kind: "claude", status: "running", source_run: "run1", fork_session: "sess-1", window: { x: 0, y: 0, width: 720, height: 480, minimized: false, z: 1 } } as AgentRecord;
}

function fakeClient(over: Partial<AgentClient> = {}): AgentClient {
  return {
    openStepSession: vi.fn(async () => record()),
    start: vi.fn(async () => record()),
    ...over,
  } as unknown as AgentClient;
}

function mount(client: AgentClient) {
  return render(
    <AgentClientProvider client={client}>
      <StepTerminal runId="run1" slug="implement" step={step} />
    </AgentClientProvider>,
  );
}

describe("StepTerminal", () => {
  beforeEach(() => agentStore.reset());
  afterEach(cleanup);

  it("forks the step session once and shows its terminal", async () => {
    const client = fakeClient();

    mount(client);

    expect(await screen.findByTestId("terminal-a1")).toHaveAttribute("data-running", "true");
    expect(client.openStepSession).toHaveBeenCalledWith("implement run1", "run1", "sess-1");
    expect(client.start).toHaveBeenCalledWith("a1");
  });

  it("re-attaches to the already started agent instead of forking again", async () => {
    const client = fakeClient();
    act(() => agentStore.upsert(record()));

    mount(client);

    expect(await screen.findByTestId("terminal-a1")).toBeInTheDocument();
    expect(client.openStepSession).not.toHaveBeenCalled();
  });

  it("shows the launch error", async () => {
    const client = fakeClient({ openStepSession: vi.fn(async () => Promise.reject(new Error("no worktree"))) });

    mount(client);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no worktree"));
  });

  it("shows the start error instead of a dead terminal", async () => {
    const client = fakeClient({ start: vi.fn(async () => Promise.reject(new Error("claude missing"))) });

    mount(client);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("claude missing"));
    expect(screen.queryByTestId("terminal-a1")).toBeNull();
  });

  it("refuses to launch past the agent capacity", async () => {
    const client = fakeClient();
    vi.spyOn(agentStore, "getIsAtCapacity").mockReturnValue(true);

    mount(client);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too many agents"));
    expect(client.openStepSession).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
