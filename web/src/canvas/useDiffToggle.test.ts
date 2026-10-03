import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { EngineClient } from "../engine-client/EngineClient";
import { useDiffToggle } from "./useDiffToggle";
import type { CanvasCamera } from "./useCanvasCamera";
import { diffOverlayStore } from "../state/diffOverlayStore";
import { expansionStore } from "../state/expansionState";
import { changeCardStore } from "../state/changeCardStore";
import { hierarchyChangesStore } from "../state/hierarchyChangesStore";
import { liveStore } from "../state/liveStore";
import { resetRefreshDiffs } from "../state/refreshDiffs";

function mockCamera(): CanvasCamera {
  return {
    frameFitTo: vi.fn(),
    suppress: vi.fn(),
    release: vi.fn(),
    isSuppressed: vi.fn(() => false),
    fitToNode: vi.fn(),
  };
}

beforeEach(() => {
  diffOverlayStore.reset();
  expansionStore.reset();
  changeCardStore.reset();
  hierarchyChangesStore.reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetRefreshDiffs();
});

describe("useDiffToggle", () => {
  it("releases the camera lock when activation fails instead of leaving it suppressed forever", async () => {
    const engineClient = {
      getDiff: vi.fn().mockRejectedValue(new Error("network blip")),
      getChangeCards: vi.fn().mockResolvedValue({ cards: [] }),
    } as unknown as EngineClient;
    const camera = mockCamera();
    const { result } = renderHook(() =>
      useDiffToggle({
        engineClient,
        rootNode: null,
        camera,
        liveVersion: liveStore.getVersion(),
        isDiffActive: false,
      }),
    );

    await expect(result.current.toggle()).resolves.toBeUndefined();

    expect(camera.suppress).toHaveBeenCalledTimes(1);
    expect(camera.release).toHaveBeenCalledTimes(1);
    expect(camera.frameFitTo).not.toHaveBeenCalled();
  });

  it("reports isPending from the click until the fetch/reveal chain settles, so the button has something to show before isDiffActive can flip", async () => {
    let resolveDiff: ((value: []) => void) | null = null;
    const engineClient = {
      getDiff: vi.fn(() => new Promise<[]>((resolve) => (resolveDiff = resolve))),
      getChangeCards: vi.fn().mockResolvedValue({ cards: [] }),
    } as unknown as EngineClient;
    const camera = mockCamera();
    const { result } = renderHook(() =>
      useDiffToggle({
        engineClient,
        rootNode: null,
        camera,
        liveVersion: liveStore.getVersion(),
        isDiffActive: false,
      }),
    );
    expect(result.current.isPending).toBe(false);

    const toggled = result.current.toggle();
    await waitFor(() => expect(result.current.isPending).toBe(true));

    resolveDiff!([]);
    await toggled;

    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it("clears isPending even when the fetch fails, instead of leaving the button stuck", async () => {
    const engineClient = {
      getDiff: vi.fn().mockRejectedValue(new Error("network blip")),
      getChangeCards: vi.fn().mockResolvedValue({ cards: [] }),
    } as unknown as EngineClient;
    const camera = mockCamera();
    const { result } = renderHook(() =>
      useDiffToggle({
        engineClient,
        rootNode: null,
        camera,
        liveVersion: liveStore.getVersion(),
        isDiffActive: false,
      }),
    );

    await result.current.toggle();

    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it("clears hierarchyChangesStore on toggle-off in the plain hierarchy view", async () => {
    diffOverlayStore.write([], true);
    hierarchyChangesStore.setStatuses({ "file::a.py": "modified" });
    const engineClient = {
      getDiff: vi.fn().mockResolvedValue([]),
      getChangeCards: vi.fn().mockResolvedValue({ cards: [], by_node_status: {} }),
    } as unknown as EngineClient;
    const camera = mockCamera();
    const { result } = renderHook(() =>
      useDiffToggle({
        engineClient,
        rootNode: null,
        camera,
        liveVersion: liveStore.getVersion(),
        isDiffActive: true,
      }),
    );

    await result.current.toggle();

    expect(hierarchyChangesStore.getStatus("file::a.py")).toBeUndefined();
  });

  it("treats a click during activation as cancel, so a hung fetch can't leave the button stuck", async () => {
    const engineClient = {
      getDiff: vi.fn(() => new Promise<[]>(() => {})),
      getChangeCards: vi.fn().mockResolvedValue({ cards: [] }),
    } as unknown as EngineClient;
    const camera = mockCamera();
    const { result } = renderHook(() =>
      useDiffToggle({
        engineClient,
        rootNode: null,
        camera,
        liveVersion: liveStore.getVersion(),
        isDiffActive: false,
      }),
    );
    void result.current.toggle();
    await waitFor(() => expect(result.current.isPending).toBe(true));

    await result.current.toggle();

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(camera.release).toHaveBeenCalled();
    expect(diffOverlayStore.getIsActive()).toBe(false);
  });

  it("never publishes a cancelled activation, even once its fetch finally lands", async () => {
    let resolveDiff: ((value: []) => void) | null = null;
    const engineClient = {
      getDiff: vi.fn(() => new Promise<[]>((resolve) => (resolveDiff = resolve))),
      getChangeCards: vi.fn().mockResolvedValue({ cards: [] }),
    } as unknown as EngineClient;
    const camera = mockCamera();
    const { result } = renderHook(() =>
      useDiffToggle({
        engineClient,
        rootNode: null,
        camera,
        liveVersion: liveStore.getVersion(),
        isDiffActive: false,
      }),
    );
    const activation = result.current.toggle();
    await waitFor(() => expect(result.current.isPending).toBe(true));
    await result.current.toggle();

    resolveDiff!([]);
    await activation;

    expect(diffOverlayStore.getIsActive()).toBe(false);
    expect(camera.frameFitTo).not.toHaveBeenCalled();
  });

  it("aborts the in-flight fetches on the cancel click, not just the publish", async () => {
    let seenSignal: AbortSignal | undefined;
    const engineClient = {
      getDiff: vi.fn((signal?: AbortSignal) => {
        seenSignal = signal;
        return new Promise<[]>(() => {});
      }),
      getChangeCards: vi.fn().mockResolvedValue({ cards: [] }),
    } as unknown as EngineClient;
    const camera = mockCamera();
    const { result } = renderHook(() =>
      useDiffToggle({
        engineClient,
        rootNode: null,
        camera,
        liveVersion: liveStore.getVersion(),
        isDiffActive: false,
      }),
    );
    void result.current.toggle();
    await waitFor(() => expect(result.current.isPending).toBe(true));

    await result.current.toggle();

    expect(seenSignal?.aborted).toBe(true);
    expect(camera.release).toHaveBeenCalled();
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it("puts back the expansion a half-finished reveal made when the activation is cancelled", async () => {
    // getDiff hands back one entry, then getNode hangs -- so the reveal is mid-walk on the cancel.
    const engineClient = {
      getDiff: vi.fn().mockResolvedValue([{ node_id: "function::deep", status: "modified" }]),
      getChangeCards: vi.fn().mockResolvedValue({ cards: [] }),
      getNode: vi.fn(() => new Promise(() => {})),
    } as unknown as EngineClient;
    const camera = mockCamera();
    expansionStore.expand("dir::src");
    const { result } = renderHook(() =>
      useDiffToggle({
        engineClient,
        rootNode: null,
        camera,
        liveVersion: liveStore.getVersion(),
        isDiffActive: false,
      }),
    );
    void result.current.toggle();
    await waitFor(() => expect(engineClient.getNode).toHaveBeenCalled());
    expansionStore.expand("file::src/deep.py");

    await result.current.toggle();

    // 🔴 Only what the reveal added is undone; what the user had open before the click survives.
    expect(expansionStore.getExpandedNodeIdsByOrder()).toEqual(["dir::src"]);
  });

  it("recolors via hierarchyChangesStore on toggle-on", async () => {
    const engineClient = {
      getDiff: vi.fn().mockResolvedValue([]),
      getChangeCards: vi
        .fn()
        .mockResolvedValue({ cards: [], by_node_status: { "file::a.py::class::A": "added" } }),
    } as unknown as EngineClient;
    const camera = mockCamera();
    const { result } = renderHook(() =>
      useDiffToggle({
        engineClient,
        rootNode: null,
        camera,
        liveVersion: liveStore.getVersion(),
        isDiffActive: true,
      }),
    );

    await result.current.toggle();

    expect(hierarchyChangesStore.getStatus("file::a.py::class::A")).toBe("added");
  });
});
