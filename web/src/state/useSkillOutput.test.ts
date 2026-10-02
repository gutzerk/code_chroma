import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSkillOutput, type SkillOutputKind } from "./useSkillOutput";
import type { EngineClient } from "../engine-client/EngineClient";
import type { DiagramGenerationStatus } from "./types";

/** A stub exposing only the two methods the hook touches, plus a hook to push a batch per kind.
 *
 * One method pair now serves every run kind, so what used to be two stubbed pairs (C1's and the
 * review's) is one pair that dispatches on the `kind` argument — which is also the thing worth
 * asserting: that the hook asks for the kind it was given. */
function clientFor(buffered: string[] = []) {
  const pushers: Partial<Record<SkillOutputKind, (lines: string[]) => void>> = {};
  const client = {
    getDiagramOutput: vi.fn(async () => buffered),
    subscribeDiagramOutput: (kind: SkillOutputKind, listener: (lines: string[]) => void) => {
      pushers[kind] = listener;
      return () => {
        delete pushers[kind];
      };
    },
  } as unknown as EngineClient;
  return {
    client,
    pushC1: (lines: string[]) => act(() => pushers.c1?.(lines)),
    pushReview: (lines: string[]) => act(() => pushers["impact-changes"]?.(lines)),
  };
}

function render(client: EngineClient, kind: SkillOutputKind = "c1") {
  return renderHook(
    ({ state }: { state: DiagramGenerationStatus["state"] }) => useSkillOutput(client, kind, state),
    { initialProps: { state: "generating" as DiagramGenerationStatus["state"] } },
  );
}

describe("useSkillOutput", () => {
  it("reads the buffer the bridge already holds, so a canvas opened mid-run isn't blank", async () => {
    const { client } = clientFor(["⏺ Read(app.py)"]);

    const { result } = render(client);

    await waitFor(() => expect(result.current).toEqual(["⏺ Read(app.py)"]));
  });

  it("appends each pushed batch in order", async () => {
    const { client, pushC1 } = clientFor();
    const { result } = render(client);
    await waitFor(() => expect(client.getDiagramOutput).toHaveBeenCalledWith("c1"));

    pushC1(["⏺ Glob(**/*.py)"]);
    pushC1(["⏺ Write(c1.json)", "✓ done in 5s"]);

    expect(result.current).toEqual(["⏺ Glob(**/*.py)", "⏺ Write(c1.json)", "✓ done in 5s"]);
  });

  it("keeps a batch that lands before the catch-up read resolves", async () => {
    const { client, pushC1 } = clientFor(["⏺ buffered"]);
    const { result } = render(client);

    pushC1(["⏺ pushed"]);

    await waitFor(() => expect(result.current).toEqual(["⏺ buffered", "⏺ pushed"]));
  });

  it("doesn't duplicate lines the catch-up read and an early push both cover", async () => {
    // A reveal for a run already well in progress: the socket delivers the same tail the buffered
    // catch-up read also returns, because both draw from the same server-side history.
    const { client, pushC1 } = clientFor(["⏺ Read(app.py)", "⏺ Glob(**/*.py)", "⏺ Write(c1.json)"]);
    const { result } = render(client);

    pushC1(["⏺ Glob(**/*.py)", "⏺ Write(c1.json)"]);

    await waitFor(() =>
      expect(result.current).toEqual(["⏺ Read(app.py)", "⏺ Glob(**/*.py)", "⏺ Write(c1.json)"]),
    );
  });

  it("collapses repeated identical heartbeat lines rather than duplicating them", async () => {
    // A real run can print the same status line back-to-back many times (e.g. "✓ done in Ns").
    // mergeCatchUp's largest-overlap-first search may undercount how many times it repeats, but it
    // must never re-show the overlap as duplicated visible lines -- see the trade-off note on
    // mergeCatchUp itself.
    const { client, pushC1 } = clientFor(["✓ done", "✓ done", "✓ done"]);
    const { result } = render(client);

    pushC1(["✓ done", "✓ done", "⏺ Write(c1.json)"]);

    await waitFor(() => expect(result.current.at(-1)).toBe("⏺ Write(c1.json)"));
    expect(result.current.every((line) => line === "✓ done" || line === "⏺ Write(c1.json)")).toBe(
      true,
    );
  });

  it("clears the feed when a genuinely fresh run starts, so stale lines don't lead it", async () => {
    // This mount's catch-up read finds an empty buffer (no run in flight when the view opened), so
    // a start reported later — a run this mount triggered — is a real fresh run, and old lines drop.
    const { client, pushC1 } = clientFor();
    const { result, rerender } = render(client);
    await waitFor(() => expect(client.getDiagramOutput).toHaveBeenCalledWith("c1"));
    // Flush the empty catch-up read so it records "no buffered history" before the start lands.
    await act(async () => {
      await Promise.resolve();
    });
    pushC1(["⏺ older run's tail"]);

    rerender({ state: "idle" });
    rerender({ state: "generating" });

    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("keeps a mid-run read's buffered lines across a remount instead of re-clearing them", async () => {
    // The view is closed and reopened while the run is rolling; a fresh mount's status fetch
    // reveals "generating" for a run this mount didn't start, and the buffer relays its history.
    const { client, pushC1 } = clientFor();
    const first = render(client);
    await waitFor(() => expect(client.getDiagramOutput).toHaveBeenCalledWith("c1"));
    pushC1(["⏺ Read(app.py)", "⏺ Glob(**/*.py)"]);

    first.unmount();

    // Reopened mid-run: the fresh mount's catch-up read returns the server's buffer, and the
    // status (via the generation hook, modeled here as the initial prop) is already "generating".
    const remounted = clientFor(["⏺ Read(app.py)", "⏺ Glob(**/*.py)"]);
    const second = renderHook(() => useSkillOutput(remounted.client, "c1", "generating"));
    await waitFor(() =>
      expect(second.result.current).toEqual(["⏺ Read(app.py)", "⏺ Glob(**/*.py)"]),
    );
    remounted.pushC1(["⏺ Write(patterns.json)"]);

    // Buffered history survives the "generating" reveal, so switching back to a view mid-run shows
    // the same run's progress — it must not look like it restarted.
    expect(second.result.current).toEqual([
      "⏺ Read(app.py)",
      "⏺ Glob(**/*.py)",
      "⏺ Write(patterns.json)",
    ]);
  });

  it("leaves the finished run's lines readable while the state stays put", async () => {
    const { client, pushC1 } = clientFor();
    const { result, rerender } = render(client);
    await waitFor(() => expect(client.getDiagramOutput).toHaveBeenCalledWith("c1"));
    pushC1(["✓ done in 5s"]);

    rerender({ state: "idle" });

    expect(result.current).toEqual(["✓ done in 5s"]);
  });

  it("caps the feed at the bridge's own line limit", async () => {
    const { client, pushC1 } = clientFor();
    const { result } = render(client);
    await waitFor(() => expect(client.getDiagramOutput).toHaveBeenCalledWith("c1"));

    pushC1(Array.from({ length: 350 }, (_unused, index) => `line ${index}`));

    expect(result.current).toHaveLength(300);
    expect(result.current[299]).toBe("line 349");
  });

  it("follows the review run's own route and event when asked for that kind", async () => {
    const { client, pushReview } = clientFor();
    const { result } = render(client, "impact-changes");
    await waitFor(() => expect(client.getDiagramOutput).toHaveBeenCalledWith("impact-changes"));

    pushReview(["⏺ Read(git diff)"]);

    expect(result.current).toEqual(["⏺ Read(git diff)"]);
    expect(client.getDiagramOutput).not.toHaveBeenCalledWith("c1");
  });
});
