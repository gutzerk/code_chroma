import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCoverageSidecar } from "./useSidecar";
import type { EngineClient } from "../engine-client/EngineClient";
import type { C1Coverage } from "./types";
import { EMPTY_C1_COVERAGE } from "../engine-client/stubEngineClient";

function coverageOf(unmapped: number): C1Coverage {
  return {
    ...EMPTY_C1_COVERAGE,
    has_diagram: true,
    total_files: 100,
    covered_files: 100 - unmapped,
    unmapped_files: unmapped,
    percent: 100 - unmapped,
  };
}

function harness(getSidecar: () => Promise<C1Coverage>) {
  const unsubscribed: string[] = [];
  const pings: { c1?: () => void; changed?: () => void } = {};
  const client = {
    getSidecar,
    subscribeDiagram: (_kind: string, listener: () => void) => {
      pings.c1 = listener;
      return () => unsubscribed.push("c1");
    },
    subscribe: (listener: () => void) => {
      pings.changed = listener;
      return () => unsubscribed.push("changed");
    },
  } as unknown as EngineClient;
  return { client, pings, unsubscribed };
}

/** A promise this test resolves by hand, so two fetches can be made to answer out of order. */
function deferred() {
  let resolve!: (value: C1Coverage) => void;
  const promise = new Promise<C1Coverage>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("useCoverageSidecar", () => {
  it("is null until the fetch answers, so a pending load never reads as full coverage", () => {
    const { client } = harness(() => new Promise<C1Coverage>(() => {}));

    const { result } = renderHook(() => useCoverageSidecar(client));

    expect(result.current).toBeNull();
  });

  it("returns what the bridge reports once the fetch lands", async () => {
    const { client } = harness(async () => coverageOf(12));

    const { result } = renderHook(() => useCoverageSidecar(client));

    await waitFor(() => expect(result.current).toEqual(coverageOf(12)));
  });

  it.each([["c1"], ["changed"]] as const)("re-fetches on the %s ping", async (channel) => {
    let call = 0;
    const { client, pings } = harness(async () => coverageOf(call++ === 0 ? 12 : 3));
    const { result } = renderHook(() => useCoverageSidecar(client));
    await waitFor(() => expect(result.current?.unmapped_files).toBe(12));

    await act(async () => pings[channel]?.());

    await waitFor(() => expect(result.current?.unmapped_files).toBe(3));
  });

  it("keeps the last good answer when a re-fetch rejects", async () => {
    let call = 0;
    const { client, pings } = harness(() =>
      call++ === 0 ? Promise.resolve(coverageOf(12)) : Promise.reject(new Error("bridge down")),
    );
    const { result } = renderHook(() => useCoverageSidecar(client));
    await waitFor(() => expect(result.current?.unmapped_files).toBe(12));

    await act(async () => pings.changed?.());

    expect(result.current?.unmapped_files).toBe(12);
  });

  it("ignores a reply a later fetch has already overtaken", async () => {
    const first = deferred();
    const second = deferred();
    const responses = [first.promise, second.promise];
    const { client, pings } = harness(() => responses.shift() ?? Promise.resolve(coverageOf(0)));
    const { result } = renderHook(() => useCoverageSidecar(client));
    act(() => pings.changed?.());

    await act(async () => {
      second.resolve(coverageOf(3));
      first.resolve(coverageOf(12));
    });

    expect(result.current?.unmapped_files).toBe(3);
  });

  it("drops both subscriptions on unmount", () => {
    const { client, unsubscribed } = harness(async () => coverageOf(0));
    const { unmount } = renderHook(() => useCoverageSidecar(client));

    unmount();

    expect(unsubscribed.sort()).toEqual(["c1", "changed"]);
  });
});
