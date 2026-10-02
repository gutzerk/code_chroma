import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { EngineClient } from "../engine-client/EngineClient";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { undoStore } from "../state/undoStore";
import { UNDO_EVENT } from "./UndoManager";
import { useFrameFit, useSavedLayout } from "./useSavedLayoutAndFitLoop";

/** Drains rAF callbacks by hand, so the retry loop can be stepped one frame at a time. */
function frameQueue() {
  let pending: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  return {
    flush() {
      const due = pending;
      pending = [];
      for (const callback of due) callback(0);
    },
    get depth() {
      return pending.length;
    },
  };
}

function setup(saved: Record<string, { x: number; y: number }> = {}) {
  const getLayout = vi.fn().mockResolvedValue(saved);
  const saveLayout = vi.fn().mockResolvedValue(undefined);
  const client = {
    getDiagramLayout: getLayout,
    saveDiagramLayout: saveLayout,
  } as unknown as EngineClient;
  const rendered = renderHook(() => useSavedLayout("hierarchy"), {
    wrapper: ({ children }) =>
      createElement(EngineClientProvider, { repoId: "test", client, children }),
  });
  return { ...rendered, getLayout, saveLayout };
}

describe("useSavedLayout", () => {
  beforeEach(() => {
    undoStore.reset();
  });

  afterEach(() => {
    undoStore.reset();
  });

  it("fetches the saved layout once on mount and seeds dragOffsets from it", async () => {
    const { result } = setup({ a: { x: 1, y: 2 } });

    await waitFor(() => expect(result.current.savedOffsets).not.toBeNull());

    expect(result.current.dragOffsets.get("a")).toEqual({ x: 1, y: 2 });
  });

  it("handleOffsetChange updates dragOffsets live without saving", async () => {
    const { result, saveLayout } = setup();
    await waitFor(() => expect(result.current.savedOffsets).not.toBeNull());

    act(() => result.current.handleOffsetChange("a", { x: 5, y: 6 }));

    expect(result.current.dragOffsets.get("a")).toEqual({ x: 5, y: 6 });
    expect(saveLayout).not.toHaveBeenCalled();
  });

  it("handleCommit persists the full merged map in one call", async () => {
    const { result, saveLayout } = setup({ existing: { x: 0, y: 0 } });
    await waitFor(() => expect(result.current.savedOffsets).not.toBeNull());

    act(() => result.current.handleCommit("moved", { x: 10, y: 20 }));

    expect(saveLayout).toHaveBeenCalledTimes(1);
    expect(saveLayout).toHaveBeenCalledWith("hierarchy", {
      existing: { x: 0, y: 0 },
      moved: { x: 10, y: 20 },
    });
  });

  it("handleCommitMany persists every moved id in a single saveLayout call", async () => {
    const { result, saveLayout } = setup({ untouched: { x: 0, y: 0 } });
    await waitFor(() => expect(result.current.savedOffsets).not.toBeNull());

    act(() =>
      result.current.handleCommitMany({
        a: { x: 1, y: 1 },
        b: { x: 2, y: 2 },
      }),
    );

    expect(saveLayout).toHaveBeenCalledTimes(1);
    expect(saveLayout).toHaveBeenCalledWith("hierarchy", {
      untouched: { x: 0, y: 0 },
      a: { x: 1, y: 1 },
      b: { x: 2, y: 2 },
    });
    expect(result.current.dragOffsets.get("a")).toEqual({ x: 1, y: 1 });
    expect(result.current.dragOffsets.get("b")).toEqual({ x: 2, y: 2 });
  });

  it("records the pre-commit layout into the undo store on a commit", async () => {
    const { result } = setup({ a: { x: 0, y: 0 } });
    await waitFor(() => expect(result.current.savedOffsets).not.toBeNull());

    act(() => result.current.handleCommit("a", { x: 10, y: 20 }));

    expect(undoStore.canUndo("hierarchy")).toBe(true);
    // Undoing this drag returns the layout that existed before it.
    expect(undoStore.undo("hierarchy")).toEqual({ a: { x: 0, y: 0 } });
  });

  it("does not record an undo entry for an unchanged (mount-resync) commit", async () => {
    const { result } = setup({ a: { x: 1, y: 2 } });
    await waitFor(() => expect(result.current.savedOffsets).not.toBeNull());

    act(() => result.current.handleCommit("a", { x: 1, y: 2 }));

    expect(undoStore.canUndo("hierarchy")).toBe(false);
  });

  it("records the PRE-drag baseline when preview writes precede commit (real group drag)", async () => {
    // A real drag's preview path (onGroupPreview -> handleOffsetChange) mutates dragOffsets live
    // as the box moves, so by commit time the live map already holds the FINAL position. The undo
    // entry must restore the layout as it was before that preview ever fired, not the landing
    // position (the regression that made group drags unrecorded no-ops).
    const { result } = setup({ a: { x: 0, y: 0 }, b: { x: 3, y: 3 } });
    await waitFor(() => expect(result.current.savedOffsets).not.toBeNull());

    // The first preview frame writes the in-flight position into dragOffsets.
    act(() => result.current.handleOffsetChange("a", { x: 4, y: 0 }));
    act(() => result.current.handleOffsetChange("b", { x: 7, y: 3 }));

    // ...and finally the commit lands at the same positions the preview already wrote.
    act(() => result.current.handleCommitMany({ a: { x: 4, y: 0 }, b: { x: 7, y: 3 } }));

    // Even though dragOffsets already held the landing positions at commit time, undo restores the
    // pre-gesture baseline for BOTH boxes.
    expect(undoStore.canUndo("hierarchy")).toBe(true);
    expect(undoStore.undo("hierarchy")).toEqual({ a: { x: 0, y: 0 }, b: { x: 3, y: 3 } });
  });

  it("restores and persists the layout for an undo of its own kind", async () => {
    const { result, saveLayout } = setup({ a: { x: 1, y: 2 } });
    await waitFor(() => expect(result.current.savedOffsets).not.toBeNull());

    act(() => result.current.handleCommit("a", { x: 9, y: 9 }));
    act(() => result.current.handleCommit("a", { x: 20, y: 20 }));
    // Undo the second drag -> back to { a: { x: 9, y: 9 } }.
    undoStore.undo("hierarchy");

    act(() => {
      window.dispatchEvent(
        new CustomEvent(UNDO_EVENT, { detail: { kind: "hierarchy", layout: { a: { x: 9, y: 9 } } } }),
      );
    });
    await waitFor(() => expect(result.current.dragOffsets.get("a")).toEqual({ x: 9, y: 9 }));
    expect(saveLayout).toHaveBeenLastCalledWith("hierarchy", { a: { x: 9, y: 9 } });
  });

  it("ignores an undo event for a different kind", async () => {
    const { result } = setup({ a: { x: 1, y: 2 } });
    await waitFor(() => expect(result.current.savedOffsets).not.toBeNull());

    act(() =>
      window.dispatchEvent(
        new CustomEvent(UNDO_EVENT, { detail: { kind: "c1", layout: { a: { x: 99, y: 99 } } } }),
      ),
    );

    expect(result.current.dragOffsets.get("a")).toEqual({ x: 1, y: 2 });
  });
});

describe("useFrameFit", () => {
  let frames: ReturnType<typeof frameQueue>;

  beforeEach(() => {
    frames = frameQueue();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops retrying once fitToNodes reports every id mounted and settled", () => {
    let mounted = false;
    const fitToNodes = vi.fn(() => mounted);
    renderHook(() => useFrameFit("a", fitToNodes));

    frames.flush();
    mounted = true;
    frames.flush();

    expect(fitToNodes).toHaveBeenCalledTimes(2);
    expect(frames.depth).toBe(0);
  });

  it("gives up after maxFrames attempts when fitToNodes never settles", () => {
    const fitToNodes = vi.fn(() => false);
    renderHook(() => useFrameFit("a,b", fitToNodes, 3));

    frames.flush();
    frames.flush();
    frames.flush();

    expect(fitToNodes).toHaveBeenCalledTimes(3);
    expect(frames.depth).toBe(0);
  });

  it("is a no-op when fitKey is falsy", () => {
    const fitToNodes = vi.fn(() => true);
    renderHook(() => useFrameFit("", fitToNodes));

    expect(frames.depth).toBe(0);
  });

  it("is a no-op when fitToNodes is undefined", () => {
    renderHook(() => useFrameFit("a", undefined));

    expect(frames.depth).toBe(0);
  });

  it("cancels the pending retry when unmounted mid-loop", () => {
    const fitToNodes = vi.fn(() => false);
    const { unmount } = renderHook(() => useFrameFit("a", fitToNodes, 5));
    frames.flush();

    unmount();
    frames.flush();

    expect(fitToNodes).toHaveBeenCalledTimes(1);
  });

  it("does not restart attempts when fitKey/fitToNodes stay referentially stable across a re-render", () => {
    const fitToNodes = vi.fn(() => false);
    const { rerender } = renderHook(({ key }) => useFrameFit(key, fitToNodes, 3), {
      initialProps: { key: "a" },
    });

    frames.flush();
    rerender({ key: "a" });
    frames.flush();
    frames.flush();
    frames.flush();

    expect(fitToNodes).toHaveBeenCalledTimes(3);
  });
});
