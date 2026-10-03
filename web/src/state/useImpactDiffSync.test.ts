import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { diffOverlayStore } from "./diffOverlayStore";
import { hierarchyChangesStore } from "./hierarchyChangesStore";
import { useImpactDiffSync } from "./useSidecar";
import type { EngineClient } from "../engine-client/EngineClient";
import type { FunctionDiff } from "./types";

const DIFFS: FunctionDiff[] = [
  {
    node_id: "function::foo",
    name: "foo",
    status: "modified",
    original_source: "a",
    proposed_source: "b",
    level: "function",
  },
];

function clientFor() {
  const getDiff = vi.fn(async () => DIFFS);
  const getChangeCards = vi.fn(async () => ({
    cards: [],
    total: 0,
    by_node_status: { "function::foo": "modified", "component::a.py": "added" },
  }));
  let ping: (() => void) | null = null;
  const client = {
    getDiff,
    getChangeCards,
    subscribe: (listener: () => void) => {
      ping = listener;
      return () => {
        ping = null;
      };
    },
  } as unknown as EngineClient;
  return {
    client,
    getDiff,
    getChangeCards,
    ping: () => ping?.(),
  };
}

afterEach(() => {
  diffOverlayStore.reset();
  hierarchyChangesStore.reset();
});

describe("useImpactDiffSync", () => {
  it("fills diffs and statuses without enabling the visual Diff mode when the impact layer is present", async () => {
    const { client } = clientFor();
    renderHook(() => useImpactDiffSync(client, true));

    await waitFor(() => expect(diffOverlayStore.getDiff("function::foo")?.status).toBe("modified"));
    expect(hierarchyChangesStore.getStatus("component::a.py")).toBe("added");
    // The impact path must not flip the global Diff toggle (that would raise the diff chrome).
    expect(diffOverlayStore.getIsActive()).toBe(false);
  });

  it("fetches nothing while the impact layer is absent", () => {
    const { client, getDiff, getChangeCards } = clientFor();
    renderHook(() => useImpactDiffSync(client, false));

    expect(getDiff).not.toHaveBeenCalled();
    expect(getChangeCards).not.toHaveBeenCalled();
  });

  it("re-syncs on a live changed ping", async () => {
    const { client, getDiff, ping } = clientFor();
    renderHook(() => useImpactDiffSync(client, true));

    await waitFor(() => expect(diffOverlayStore.getDiff("function::foo")).toBeDefined());
    const calls = getDiff.mock.calls.length;
    ping();
    await waitFor(() => expect(getDiff.mock.calls.length).toBeGreaterThan(calls));
  });

  it("coalesces changed-pings while a fetch is in flight (one run, one trailing rerun)", async () => {
    // A fetch that never resolves lets us observe in-flight coalescing without race noise.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { client, getDiff, ping } = clientFor();
    getDiff.mockReturnValue(gate.then(() => DIFFS) as Promise<FunctionDiff[]>);
    renderHook(() => useImpactDiffSync(client, true));

    await waitFor(() => expect(getDiff).toHaveBeenCalled());
    // Two pings while the first run is still in flight: coalesce into one trailing rerun.
    ping();
    ping();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getDiff.mock.calls.length).toBe(1);

    // Releasing the in-flight run publishes and runs the single coalesced rerun.
    await act(async () => {
      release();
    });
    await waitFor(() => {
      expect(getDiff.mock.calls.length).toBe(2);
      expect(diffOverlayStore.getDiff("function::foo")).toBeDefined();
    });
  });

  it("does not refetch while the global Diff toggle is on (its reconciler fills the stores)", async () => {
    const { client, getDiff, ping } = clientFor();
    renderHook(() => useImpactDiffSync(client, true));
    await waitFor(() => expect(diffOverlayStore.getDiff("function::foo")).toBeDefined());
    const callsAfterInitial = getDiff.mock.calls.length;

    // Global Diff ON: the reconciler owns the stores, so a ping must not trigger an impact refetch
    // on top of it (that would double the diff work on every changed-ping).
    act(() => {
      diffOverlayStore.write([...DIFFS], true);
    });
    ping();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getDiff.mock.calls.length).toBe(callsAfterInitial);
  });

  it("refills after the global Diff toggle turns off (its clear wipes this impact fill)", async () => {
    const { client, getDiff } = clientFor();
    renderHook(() => useImpactDiffSync(client, true));

    await waitFor(() => expect(diffOverlayStore.getDiff("function::foo")).toBeDefined());
    const callsAfterInitial = getDiff.mock.calls.length;

    // Simulate the global Diff toggle as two separate user actions: ON, then OFF. Turning OFF
    // clears the stores, which this hook must detect and repopulate in place.
    act(() => {
      diffOverlayStore.write([...DIFFS], true); // global Diff ON
    });
    act(() => {
      diffOverlayStore.clear(); // global Diff OFF -> wipes; hook should refill
    });

    await waitFor(() => {
      expect(diffOverlayStore.getIsActive()).toBe(false);
      expect(getDiff.mock.calls.length).toBeGreaterThan(callsAfterInitial);
      expect(diffOverlayStore.getDiff("function::foo")).toBeDefined();
    });
  });
});
