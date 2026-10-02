import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useEpicBrief } from "./useEpicBrief";
import type { EngineClient } from "../engine-client/EngineClient";
import type { EpicBriefJobState } from "./types";
import {
  DIAGRAM_STUB,
  EPICS_STUB,
  RESEARCH_STUB,
  EPIC_BRIEF_STUB,
} from "../engine-client/stubEngineClient";

const IDLE_NO_BRIEF: EpicBriefJobState = { job_key: "", state: "idle", error: null, brief: null };

const IDLE_WITH_BRIEF: EpicBriefJobState = {
  job_key: "main:EP-A-01",
  state: "idle",
  error: null,
  brief: {
    epic_id: "EP-A-01",
    generated_at: "",
    problem: [],
    component: null,
    spokes: [],
    scope: [],
    prep_tasks: [],
    dependencies: [],
    acceptance: [],
  },
};

function clientFor(
  getResult: EpicBriefJobState,
  generateResult?: EpicBriefJobState,
  pollResult?: EpicBriefJobState,
): { client: EngineClient; generateCalls: () => number } {
  let generateCount = 0;
  const generateEpicBrief = async (): Promise<EpicBriefJobState> => {
    generateCount += 1;
    return generateResult ?? getResult;
  };
  return {
    client: {
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
      generateEpicBrief,
      getEpicBrief: async () => pollResult ?? getResult,
    },
    generateCalls: () => generateCount,
  };
}

describe("useEpicBrief", () => {
  it("with no itemId, exposes the idle-empty job without fetching anything", () => {
    const { client } = clientFor(IDLE_WITH_BRIEF);
    const { result } = renderHook(() => useEpicBrief(client, null));

    expect(result.current.job).toEqual(IDLE_NO_BRIEF);
  });

  it("mounting with an itemId fetches its already-generated brief", async () => {
    const { client } = clientFor(IDLE_WITH_BRIEF);
    const { result } = renderHook(() => useEpicBrief(client, "EP-A-01"));

    await waitFor(() => expect(result.current.job.brief?.epic_id).toBe("EP-A-01"));
  });

  it("generating a brief that finishes inline exposes the idle job with its brief", async () => {
    const { client } = clientFor(IDLE_NO_BRIEF, IDLE_WITH_BRIEF);
    const { result } = renderHook(() => useEpicBrief(client, "EP-A-01"));
    await waitFor(() => expect(result.current.job.state).toBe("idle"));

    act(() => result.current.generate());

    await waitFor(() => expect(result.current.job.brief?.epic_id).toBe("EP-A-01"));
  });

  it("generate while a brief is already generating does not start a new run", async () => {
    const generating: EpicBriefJobState = {
      job_key: "main:EP-A-01",
      state: "generating",
      error: null,
      brief: null,
    };
    const { client, generateCalls } = clientFor(generating, IDLE_WITH_BRIEF, generating);
    const { result } = renderHook(() => useEpicBrief(client, "EP-A-01"));

    await waitFor(() => expect(result.current.job.state).toBe("generating"));

    // A generate re-fired this render (e.g. switching back to the view mid-run) must not POST.
    act(() => result.current.generate());
    await act(async () => {
      await Promise.resolve();
    });

    expect(generateCalls()).toBe(0);
  });

  it("two generates in the same tick issue only one POST", async () => {
    // A rapid double-click fires generate() twice before the first POST settles — `job.state` is
    // still the same value in both calls, so only the optimistic inFlightRef lock (not the state
    // guard) can stop the duplicate. This is the client-sided surface of the "second claude
    // process" risk (the cross-tab case is the server's job).
    const { client, generateCalls } = clientFor(IDLE_NO_BRIEF, IDLE_WITH_BRIEF);
    const { result } = renderHook(() => useEpicBrief(client, "EP-A-01"));
    await waitFor(() => expect(result.current.job.state).toBe("idle"));

    act(() => result.current.generate());
    act(() => result.current.generate());
    await act(async () => {
      await Promise.resolve();
    });

    expect(generateCalls()).toBe(1);
  });

  it("a generating job polls until it reports idle with a brief", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const generating: EpicBriefJobState = {
      job_key: "main:EP-A-01",
      state: "generating",
      error: null,
      brief: null,
    };
    const { client } = clientFor(IDLE_NO_BRIEF, generating, IDLE_WITH_BRIEF);
    const { result } = renderHook(() => useEpicBrief(client, "EP-A-01"));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.generate();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.job.state).toBe("idle");
    expect(result.current.job.brief?.epic_id).toBe("EP-A-01");
    vi.useRealTimers();
  });

  it("stop() cancels a generating brief and applies the idle job it returns", async () => {
    const generating: EpicBriefJobState = {
      job_key: "main:EP-A-01",
      state: "generating",
      error: null,
      brief: null,
    };
    const cancelled: EpicBriefJobState = {
      job_key: "main:EP-A-01",
      state: "idle",
      error: null,
      brief: null,
    };
    let cancelCalls = 0;
    const client: EngineClient = {
      ...clientFor(generating, generating, generating).client,
      cancelEpicBrief: async () => {
        cancelCalls += 1;
        return cancelled;
      },
    };
    const { result } = renderHook(() => useEpicBrief(client, "EP-A-01"));
    await waitFor(() => expect(result.current.job.state).toBe("generating"));

    act(() => result.current.stop());

    await waitFor(() => expect(cancelCalls).toBe(1));
    await waitFor(() => expect(result.current.job.state).toBe("idle"));
  });
});
