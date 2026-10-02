import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useResearch } from "./useResearch";
import type { EngineClient } from "../engine-client/EngineClient";
import type { ResearchJobState } from "./types";
import { DIAGRAM_STUB, EPICS_STUB, RESEARCH_STUB, EPIC_BRIEF_STUB } from "../engine-client/stubEngineClient";

const DONE_ANSWER: ResearchJobState = {
  job_key: "main:abc",
  state: "done",
  error: null,
  answer: { query: "q", answer: "the answer", citations: [], degraded: false, generated_at: "" },
};

function clientFor(askResult: ResearchJobState, pollResult?: ResearchJobState): EngineClient {
  return {
    ...DIAGRAM_STUB,
    ...EPICS_STUB,
    ...RESEARCH_STUB,
    ...EPIC_BRIEF_STUB,
    getNode: async () => null,
    getChildren: async () => [],
    getConnections: async () => [],
    getDiff: async () => [],
    acceptDiff: async () => {},
    listTraces: async () => [],
    getTrace: async () => ({ id: "", entry: "", created_at: "", status: "ok", steps: [] }),
    subscribe: () => () => {},
    subscribeTrace: () => () => {},
    subscribeTraceStream: () => () => {},
    askResearch: async () => askResult,
    getResearchAnswer: async () => pollResult ?? askResult,
  };
}

describe("useResearch", () => {
  it("asking a question that finishes inline exposes the done job", async () => {
    const client = clientFor(DONE_ANSWER);
    const { result } = renderHook(() => useResearch(client));

    act(() => result.current.ask("q"));

    await waitFor(() => expect(result.current.job.state).toBe("done"));
    expect(result.current.job.answer?.answer).toBe("the answer");
  });

  it("a generating job polls until it reports done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const generating: ResearchJobState = { job_key: "main:abc", state: "generating", error: null, answer: null };
    const client = clientFor(generating, DONE_ANSWER);
    const { result } = renderHook(() => useResearch(client));

    await act(async () => {
      result.current.ask("q");
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.job.state).toBe("done");
    vi.useRealTimers();
  });
});
