import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWikiGeneralStatus } from "./useWikiGeneralStatus";
import type { EngineClient } from "../engine-client/EngineClient";
import type { DiagramGenerationStatus, WikiGeneralStatus } from "./types";
import {
  DIAGRAM_STUB,
  EPICS_STUB,
  EPIC_BRIEF_STUB,
} from "../engine-client/stubEngineClient";

const NOT_GENERATED: WikiGeneralStatus = {
  state: "idle",
  error: null,
  has_wiki_general: false,
  stale: false,
  empty: false,
};
const GENERATED: WikiGeneralStatus = {
  state: "idle",
  error: null,
  has_wiki_general: true,
  stale: false,
  empty: false,
};
const STALE: WikiGeneralStatus = {
  state: "idle",
  error: null,
  has_wiki_general: true,
  stale: true,
  empty: false,
};

function clientWith(overrides: Partial<EngineClient>): EngineClient {
  return {
    ...DIAGRAM_STUB,
    ...EPICS_STUB,
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
    getWikiGeneralStatus: async () => NOT_GENERATED,
    ...overrides,
  };
}

describe("useWikiGeneralStatus", () => {
  it("fetches the initial status on mount", async () => {
    const client = clientWith({ getWikiGeneralStatus: async () => GENERATED });
    const { result } = renderHook(() => useWikiGeneralStatus(client));

    await waitFor(() => expect(result.current.has_wiki_general).toBe(true));
  });

  it("trigger() starts a run and applies the generating state it returns", async () => {
    let generateCalls = 0;
    const client = clientWith({
      generateDiagram: async (): Promise<DiagramGenerationStatus> => {
        generateCalls += 1;
        return { state: "generating", error: null };
      },
    });
    const { result } = renderHook(() => useWikiGeneralStatus(client));
    await waitFor(() => expect(result.current.state).toBe("idle"));

    act(() => result.current.trigger());

    await waitFor(() => expect(result.current.state).toBe("generating"));
    expect(generateCalls).toBe(1);
    expect(result.current.has_wiki_general).toBe(false);
  });

  it("trigger() flips to generating immediately, before the generate call resolves", async () => {
    let resolveGenerate: ((status: DiagramGenerationStatus) => void) | null = null;
    const client = clientWith({
      generateDiagram: () =>
        new Promise<DiagramGenerationStatus>((resolve) => {
          resolveGenerate = resolve;
        }),
    });
    const { result } = renderHook(() => useWikiGeneralStatus(client));
    await waitFor(() => expect(result.current.state).toBe("idle"));

    act(() => result.current.trigger());

    // The bridge's generate route now also clears stale pages and syncs the plain wiki before it
    // resolves, so this is no longer near-instant -- the UI must not wait on it to show progress.
    expect(result.current.state).toBe("generating");
    await act(async () => {
      resolveGenerate?.({ state: "generating", error: null });
      await Promise.resolve();
    });
  });

  it("trigger() while already generating does not start a second run", async () => {
    let generateCalls = 0;
    const client = clientWith({
      getWikiGeneralStatus: async () => ({
        state: "generating",
        error: null,
        has_wiki_general: false,
        stale: false,
        empty: false,
      }),
      generateDiagram: async (): Promise<DiagramGenerationStatus> => {
        generateCalls += 1;
        return { state: "generating", error: null };
      },
    });
    const { result } = renderHook(() => useWikiGeneralStatus(client));
    await waitFor(() => expect(result.current.state).toBe("generating"));

    act(() => result.current.trigger());

    expect(generateCalls).toBe(0);
  });

  it("stop() cancels the run and applies the idle state it returns", async () => {
    let cancelCalls = 0;
    const client = clientWith({
      getWikiGeneralStatus: async () => ({
        state: "generating",
        error: null,
        has_wiki_general: false,
        stale: false,
        empty: false,
      }),
      cancelDiagram: async (): Promise<DiagramGenerationStatus> => {
        cancelCalls += 1;
        return { state: "idle", error: null };
      },
    });
    const { result } = renderHook(() => useWikiGeneralStatus(client));
    await waitFor(() => expect(result.current.state).toBe("generating"));

    act(() => result.current.stop());

    await waitFor(() => expect(result.current.state).toBe("idle"));
    expect(cancelCalls).toBe(1);
  });

  it("a job-status ping reaching idle refetches has_wiki_general", async () => {
    let statusChanged: ((status: DiagramGenerationStatus) => void) | null = null;
    let fetchCount = 0;
    const client = clientWith({
      getWikiGeneralStatus: async () => {
        fetchCount += 1;
        return fetchCount === 1 ? NOT_GENERATED : GENERATED;
      },
      subscribeDiagramStatus: (_kind, onChange) => {
        statusChanged = onChange;
        return () => {
          statusChanged = null;
        };
      },
    });
    const { result } = renderHook(() => useWikiGeneralStatus(client));
    await waitFor(() => expect(fetchCount).toBe(1));

    act(() => statusChanged?.({ state: "idle", error: null }));

    await waitFor(() => expect(result.current.has_wiki_general).toBe(true));
    expect(fetchCount).toBe(2);
  });

  it("a content ping merges empty the same way it merges has_wiki_general/stale", async () => {
    let contentChanged: (() => void) | null = null;
    let fetchCount = 0;
    const client = clientWith({
      getWikiGeneralStatus: async () => {
        fetchCount += 1;
        return fetchCount === 1 ? { ...NOT_GENERATED, empty: true } : NOT_GENERATED;
      },
      subscribeDiagram: (_kind, onChange) => {
        contentChanged = onChange;
        return () => {
          contentChanged = null;
        };
      },
    });
    const { result } = renderHook(() => useWikiGeneralStatus(client));
    await waitFor(() => expect(result.current.empty).toBe(true));

    act(() => contentChanged?.());

    await waitFor(() => expect(result.current.empty).toBe(false));
  });

  it("a wiki-general content ping refetches the status", async () => {
    let contentChanged: (() => void) | null = null;
    let fetchCount = 0;
    const client = clientWith({
      getWikiGeneralStatus: async () => {
        fetchCount += 1;
        return fetchCount === 1 ? NOT_GENERATED : GENERATED;
      },
      subscribeDiagram: (_kind, onChange) => {
        contentChanged = onChange;
        return () => {
          contentChanged = null;
        };
      },
    });
    const { result } = renderHook(() => useWikiGeneralStatus(client));
    await waitFor(() => expect(fetchCount).toBe(1));

    act(() => contentChanged?.());

    await waitFor(() => expect(result.current.has_wiki_general).toBe(true));
  });

  it("a commit ping surfaces stale through both refetch paths", async () => {
    let contentChanged: (() => void) | null = null;
    let fetchCount = 0;
    const client = clientWith({
      getWikiGeneralStatus: async () => {
        fetchCount += 1;
        return fetchCount === 1 ? GENERATED : STALE;
      },
      subscribeDiagram: (_kind, onChange) => {
        contentChanged = onChange;
        return () => {
          contentChanged = null;
        };
      },
    });
    const { result } = renderHook(() => useWikiGeneralStatus(client));
    await waitFor(() => expect(result.current.stale).toBe(false));

    act(() => contentChanged?.());

    await waitFor(() => expect(result.current.stale).toBe(true));
  });

  it("update() starts a run and applies the generating state it returns", async () => {
    let updateCalls = 0;
    const client = clientWith({
      getWikiGeneralStatus: async () => GENERATED,
      updateWikiGeneral: async (): Promise<DiagramGenerationStatus> => {
        updateCalls += 1;
        return { state: "generating", error: null };
      },
    });
    const { result } = renderHook(() => useWikiGeneralStatus(client));
    await waitFor(() => expect(result.current.state).toBe("idle"));

    act(() => result.current.update());

    await waitFor(() => expect(result.current.state).toBe("generating"));
    expect(updateCalls).toBe(1);
  });

  it("update() while already generating does not start a second run", async () => {
    let updateCalls = 0;
    const client = clientWith({
      getWikiGeneralStatus: async () => ({
        state: "generating",
        error: null,
        has_wiki_general: true,
        stale: true,
        empty: false,
      }),
      updateWikiGeneral: async (): Promise<DiagramGenerationStatus> => {
        updateCalls += 1;
        return { state: "generating", error: null };
      },
    });
    const { result } = renderHook(() => useWikiGeneralStatus(client));
    await waitFor(() => expect(result.current.state).toBe("generating"));

    act(() => result.current.update());

    expect(updateCalls).toBe(0);
  });

  it("a content ping mid-generate never clobbers the generating state back to idle", async () => {
    // Regression: prepare_new_run's clear_wiki_general() deletes index.md before the backend job
    // flips to "generating", so the content-changed ping (and its refetch) can resolve with a
    // stale "idle" snapshot while the UI is already (optimistically) showing "generating".
    let contentChanged: (() => void) | null = null;
    let resolveGenerate: ((status: DiagramGenerationStatus) => void) | null = null;
    const client = clientWith({
      getWikiGeneralStatus: async () => NOT_GENERATED,
      generateDiagram: () =>
        new Promise<DiagramGenerationStatus>((resolve) => {
          resolveGenerate = resolve;
        }),
      subscribeDiagram: (_kind, onChange) => {
        contentChanged = onChange;
        return () => {
          contentChanged = null;
        };
      },
    });
    const { result } = renderHook(() => useWikiGeneralStatus(client));
    await waitFor(() => expect(result.current.state).toBe("idle"));

    act(() => result.current.trigger());
    expect(result.current.state).toBe("generating");

    await act(async () => {
      contentChanged?.();
      await Promise.resolve();
    });

    expect(result.current.state).toBe("generating");
    await act(async () => {
      resolveGenerate?.({ state: "generating", error: null });
      await Promise.resolve();
    });
  });

  it("unsubscribes both listeners on unmount", async () => {
    let statusUnsubscribed = false;
    let contentUnsubscribed = false;
    const client = clientWith({
      subscribeDiagramStatus: () => () => {
        statusUnsubscribed = true;
      },
      subscribeDiagram: () => () => {
        contentUnsubscribed = true;
      },
    });
    const { result, unmount } = renderHook(() => useWikiGeneralStatus(client));
    await waitFor(() => expect(result.current.state).toBe("idle"));

    unmount();

    expect(statusUnsubscribed).toBe(true);
    expect(contentUnsubscribed).toBe(true);
  });
});
