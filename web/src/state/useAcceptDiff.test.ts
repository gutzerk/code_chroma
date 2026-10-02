import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAcceptDiff } from "./useAcceptDiff";
import type { EngineClient } from "../engine-client/EngineClient";
import { EPICS_STUB, RESEARCH_STUB, EPIC_BRIEF_STUB, IMPACT_CHANGES_STUB, PATTERNS_STUB, diagramStub } from "../engine-client/stubEngineClient";

function clientAccepting(onAcceptDiff: (nodeId: string) => Promise<void>): EngineClient {
  return {
    ...IMPACT_CHANGES_STUB,
    ...EPICS_STUB,
    ...RESEARCH_STUB,
    ...EPIC_BRIEF_STUB,
    ...PATTERNS_STUB,
    getNode: async () => null,
    getChildren: async () => [],
    getConnections: async () => [],
    getDiff: async () => [],
    acceptDiff: onAcceptDiff,
    getDiagram: diagramStub({ c1: ({ nodes: [], relations: [] }) }),
    getDiagramLayout: async () => ({}),
    saveDiagramLayout: async () => {},
    generateDiagram: async () => ({ state: "idle" }),
    getDiagramStatus: async () => ({ state: "idle" }),
    listTraces: async () => [],
    getTrace: async () => ({ id: "", entry: "", created_at: "", status: "ok", steps: [] }),
    subscribe: () => () => {},
    subscribeDiagram: () => () => {},
    subscribeDiagramStatus: () => () => {},
    subscribeTrace: () => () => {},
    subscribeTraceStream: () => () => {},
  };
}

describe("useAcceptDiff", () => {
  it("calls onAccepted with the node id after a successful commit", async () => {
    const client = clientAccepting(async () => {});
    const onAccepted = vi.fn();
    const { result } = renderHook(() => useAcceptDiff(client, onAccepted));

    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.handleAccept("function::foo");
    });

    expect(accepted).toBe(true);
    expect(onAccepted).toHaveBeenCalledWith("function::foo");
  });

  it("does not call onAccepted when the commit fails", async () => {
    const client = clientAccepting(async () => {
      throw new Error("boom");
    });
    const onAccepted = vi.fn();
    const { result } = renderHook(() => useAcceptDiff(client, onAccepted));

    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.handleAccept("function::foo");
    });

    expect(accepted).toBe(false);
    expect(onAccepted).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.acceptError).toBe("boom"));
  });

  it("works without an onAccepted callback (e.g. DeletedDiffOverlay, which has no code view to close)", async () => {
    const client = clientAccepting(async () => {});
    const { result } = renderHook(() => useAcceptDiff(client));

    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.handleAccept("function::foo");
    });

    expect(accepted).toBe(true);
  });
});
