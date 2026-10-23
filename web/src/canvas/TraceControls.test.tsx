import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MockBridgeEngineClient } from "../engine-client/mockBridge";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { traceStore } from "../state/traceStore";
import type { Trace, TraceFrame, TraceSummary } from "../state/types";
import { TraceControls } from "./TraceControls";

function frame(seq: number, event: TraceFrame["event"], nodeId: string, depth = 0): TraceFrame {
  return { seq, node_id: nodeId, event, depth };
}

const TRACE: Trace = {
  id: "t1",
  entry: "main",
  created_at: "now",
  status: "ok",
  steps: [
    frame(0, "call", "a", 0),
    frame(1, "call", "b", 1),
    frame(2, "return", "b", 1),
    frame(3, "return", "a", 0),
  ],
};

const SUMMARIES: TraceSummary[] = [
  { id: "t1", entry: "main", created_at: "now", status: "ok", step_count: 4 },
  { id: "t2", entry: "", created_at: "now", status: "failed", step_count: 2 },
];

async function setup(summaries: TraceSummary[] = SUMMARIES) {
  const client = new MockBridgeEngineClient();
  vi.spyOn(client, "listTraces").mockResolvedValue(summaries);
  vi.spyOn(client, "getTrace").mockResolvedValue(TRACE);
  render(
    <EngineClientProvider repoId="default" client={client}>
      <TraceControls />
    </EngineClientProvider>,
  );
  await act(async () => {});
  return client;
}

describe("TraceControls", () => {
  beforeEach(() => traceStore.reset());
  afterEach(cleanup);

  it("lists recorded traces and marks failed ones", async () => {
    await setup();

    expect(await screen.findByRole("option", { name: "main (4)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "⚠ t2 (2)" })).toBeInTheDocument();
  });

  it("loads the picked trace into the store", async () => {
    const client = await setup();
    await screen.findByRole("option", { name: "main (4)" });

    fireEvent.change(screen.getByLabelText("Choose a recorded trace"), { target: { value: "t1" } });

    await waitFor(() => expect(client.getTrace).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(screen.getByTestId("trace-step-counter")).toHaveTextContent("1/4"));
  });

  it("falls back to an empty list when listing traces fails", async () => {
    const client = new MockBridgeEngineClient();
    vi.spyOn(client, "listTraces").mockRejectedValue(new Error("down"));
    render(
      <EngineClientProvider repoId="default" client={client}>
        <TraceControls />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(client.listTraces).toHaveBeenCalled());

    expect(within(screen.getByLabelText("Choose a recorded trace")).getAllByRole("option")).toHaveLength(1);
  });

  it("disables playback controls until a trace is loaded", async () => {
    await setup([]);

    expect(screen.getByLabelText("Step forward")).toBeDisabled();
    expect(screen.getByLabelText("Play")).toBeDisabled();
    expect(screen.getByLabelText("Scrub trace")).toBeDisabled();
    expect(screen.getByTestId("trace-step-counter")).toHaveTextContent("0/0");
  });

  it("steps forward and back through the loaded trace", async () => {
    await setup([]);
    act(() => traceStore.loadTrace(TRACE));

    fireEvent.click(screen.getByLabelText("Step forward"));
    expect(screen.getByTestId("trace-step-counter")).toHaveTextContent("2/4");
    fireEvent.click(screen.getByLabelText("Step back"));

    expect(screen.getByTestId("trace-step-counter")).toHaveTextContent("1/4");
  });

  it("reconstructs the call stack at the current step", async () => {
    await setup([]);
    act(() => traceStore.loadTrace(TRACE));

    act(() => traceStore.scrubTo(1));
    const during = screen.getByTestId("trace-callstack").querySelectorAll("li").length;
    act(() => traceStore.scrubTo(3));
    const after = screen.getByTestId("trace-callstack").querySelectorAll("li").length;

    expect(during).toBe(2);
    expect(after).toBe(0);
  });

  it("shows the error plaque and an error marker for a raise frame", async () => {
    await setup([]);
    const raising: Trace = {
      ...TRACE,
      status: "failed",
      steps: [
        frame(0, "call", "a"),
        {
          ...frame(1, "raise", "a"),
          error: { type: "ValueError", message: "bad", handled: false },
        },
      ],
    };
    act(() => traceStore.loadTrace(raising));

    act(() => traceStore.scrubTo(1));

    expect(screen.getByTestId("trace-error-plaque")).toHaveTextContent("ValueError: bad");
    expect(screen.getByTestId("trace-current-node")).toHaveTextContent("raise");
  });

  it("toggles a breakpoint on the current node", async () => {
    await setup([]);
    act(() => traceStore.loadTrace(TRACE));
    const button = screen.getByRole("button", { name: "Breakpoint" });

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("closing clears the trace", async () => {
    await setup([]);
    act(() => traceStore.loadTrace(TRACE));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.getByTestId("trace-step-counter")).toHaveTextContent("0/0");
  });

  it("changing the speed updates the select", async () => {
    await setup([]);

    fireEvent.change(screen.getByLabelText("Playback speed"), { target: { value: "2" } });

    expect(screen.getByLabelText("Playback speed")).toHaveValue("2");
  });
});
