import { afterEach, describe, expect, it, vi } from "vitest";
import { traceStore } from "./traceStore";
import type { Trace, TraceFrame } from "./types";

function frame(seq: number, nodeId: string, event: TraceFrame["event"]): TraceFrame {
  return { seq, node_id: nodeId, event, depth: 0 };
}

const OK_TRACE: Trace = {
  id: "t1",
  entry: "main()",
  created_at: "",
  status: "ok",
  steps: [frame(0, "a", "call"), frame(1, "b", "call"), frame(2, "b", "return")],
};

const FAILED_TRACE: Trace = {
  id: "t2",
  entry: "boom()",
  created_at: "",
  status: "failed",
  steps: [
    frame(0, "a", "call"),
    frame(1, "b", "call"),
    { seq: 2, node_id: "b", event: "raise", depth: 1, error: { type: "ValueError", message: "x", handled: false } },
    { seq: 3, node_id: "b", event: "unwind", depth: 1, error: { type: "ValueError", message: "x", handled: false } },
  ],
};

afterEach(() => {
  traceStore.reset();
});

describe("traceStore", () => {
  it("loadTrace activates playback at the first step", () => {
    traceStore.loadTrace(OK_TRACE);

    const snap = traceStore.getSnapshot();
    expect(snap.isActive).toBe(true);
    expect(snap.stepIndex).toBe(0);
    expect(snap.currentFrame?.node_id).toBe("a");
  });

  it("stepForward and stepBack clamp to the trace bounds", () => {
    traceStore.loadTrace(OK_TRACE);

    traceStore.stepBack();
    expect(traceStore.getSnapshot().stepIndex).toBe(0);
    traceStore.stepForward();
    traceStore.stepForward();
    traceStore.stepForward();
    expect(traceStore.getSnapshot().stepIndex).toBe(2);
  });

  it("play pauses on a breakpoint node", () => {
    vi.useFakeTimers();
    traceStore.loadTrace(OK_TRACE);
    traceStore.toggleBreakpoint("b");

    traceStore.play();
    vi.advanceTimersByTime(5000);

    const snap = traceStore.getSnapshot();
    expect(snap.isPlaying).toBe(false);
    expect(snap.currentFrame?.node_id).toBe("b");
    vi.useRealTimers();
  });

  it("play on a failed trace stops on the culprit raise frame", () => {
    vi.useFakeTimers();
    traceStore.loadTrace(FAILED_TRACE);

    traceStore.play();
    vi.advanceTimersByTime(10000);

    const snap = traceStore.getSnapshot();
    expect(snap.isPlaying).toBe(false);
    expect(snap.stepIndex).toBe(2);
    expect(snap.currentFrame?.event).toBe("raise");
    vi.useRealTimers();
  });

  it("ensureLive starts a run so streamed steps arriving before trace-start aren't dropped", () => {
    traceStore.ensureLive("live-reconnect");
    traceStore.appendStep(frame(0, "a", "call"));

    const snap = traceStore.getSnapshot();
    expect(snap.isLive).toBe(true);
    expect(snap.trace?.steps).toHaveLength(1);
  });

  it("ensureLive is a no-op once a live run is already active", () => {
    traceStore.startLive("live1");
    traceStore.appendStep(frame(0, "a", "call"));
    traceStore.ensureLive("live1");

    expect(traceStore.getSnapshot().trace?.steps).toHaveLength(1);
  });

  it("loadTrace normalizes a malformed non-array steps field to an empty list", () => {
    const malformed = { id: "bad", entry: "", created_at: "", status: "ok", steps: {} } as unknown as Trace;
    traceStore.loadTrace(malformed);

    expect(Array.isArray(traceStore.getSnapshot().trace?.steps)).toBe(true);
    expect(traceStore.getSnapshot().trace?.steps).toHaveLength(0);
  });

  it("live mode appends streamed steps and blocks scrubbing until it ends", () => {
    traceStore.startLive("live1");
    traceStore.appendStep(frame(0, "a", "call"));
    traceStore.appendStep(frame(1, "b", "call"));

    traceStore.scrubTo(0);
    expect(traceStore.getSnapshot().stepIndex).toBe(1);
    expect(traceStore.getSnapshot().isLive).toBe(true);

    traceStore.endLive("ok");
    traceStore.scrubTo(0);
    expect(traceStore.getSnapshot().isLive).toBe(false);
    expect(traceStore.getSnapshot().stepIndex).toBe(0);
  });
});
