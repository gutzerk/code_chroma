import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { FIT_MAX_FRAMES, useCanvasCamera } from "./useCanvasCamera";
import type { CanvasViewportHandle } from "./CanvasViewport";

/** Drains rAF callbacks by hand, so the retry loop can be stepped one frame at a time. */
function frameQueue() {
  let pending: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  return {
    /** Runs whatever is queued right now; callbacks queued during the flush wait for the next. */
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

function cameraOver(fitToNodes: () => boolean) {
  const handle = { fitToNodes, fitToNode: vi.fn() } as unknown as CanvasViewportHandle;
  const ref = { current: handle };
  const { result } = renderHook(() => useCanvasCamera(ref));
  return { camera: result.current, handle };
}

let frames: ReturnType<typeof frameQueue>;

beforeEach(() => {
  frames = frameQueue();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCanvasCamera", () => {
  it("stops retrying once every block has been framed", () => {
    const fitToNodes = vi.fn(() => true);
    const { camera } = cameraOver(fitToNodes);

    camera.frameFitTo(["a"]);
    frames.flush();

    expect(fitToNodes).toHaveBeenCalledTimes(1);
    expect(frames.depth).toBe(0);
  });

  it("keeps retrying while blocks are still mounting", () => {
    let mounted = false;
    const fitToNodes = vi.fn(() => mounted);
    const { camera } = cameraOver(fitToNodes);

    camera.frameFitTo(["a"]);
    frames.flush();
    frames.flush();
    mounted = true;
    frames.flush();

    expect(fitToNodes).toHaveBeenCalledTimes(3);
    expect(frames.depth).toBe(0);
  });

  it("gives up rather than retrying forever when a block never mounts", () => {
    const fitToNodes = vi.fn(() => false);
    const { camera } = cameraOver(fitToNodes);

    camera.frameFitTo(["never-mounts"]);
    for (let i = 0; i < FIT_MAX_FRAMES * 2 && frames.depth > 0; i += 1) frames.flush();

    // The cap is what stops a permanently-missing id from pinning a rAF loop for the session.
    expect(fitToNodes).toHaveBeenCalledTimes(FIT_MAX_FRAMES);
    expect(frames.depth).toBe(0);
  });

  it("does not spin at all when there is nothing to frame", () => {
    const fitToNodes = vi.fn(() => false);
    const { camera } = cameraOver(fitToNodes);

    camera.frameFitTo([]);
    frames.flush();

    expect(frames.depth).toBe(0);
  });

  it("releases the auto-fit lock once the framing settles", () => {
    const { camera } = cameraOver(() => true);
    camera.suppress();

    expect(camera.isSuppressed()).toBe(true);
    camera.frameFitTo(["a"]);
    frames.flush();

    expect(camera.isSuppressed()).toBe(false);
  });

  it("leaves the lock alone when the caller never took it", () => {
    const { camera } = cameraOver(() => true);
    camera.suppress();

    camera.frameFitTo(["a"], false);
    frames.flush();

    expect(camera.isSuppressed()).toBe(true);
  });

  it("releases the lock even when the framing gave up", () => {
    const { camera } = cameraOver(() => false);
    camera.suppress();

    camera.frameFitTo(["never-mounts"]);
    for (let i = 0; i < FIT_MAX_FRAMES * 2 && frames.depth > 0; i += 1) frames.flush();

    expect(camera.isSuppressed()).toBe(false);
  });

  it("cancels an older still-running loop once a newer frameFitTo call starts", () => {
    const fitToNodes = vi.fn(() => false);
    const { camera } = cameraOver(fitToNodes);

    camera.frameFitTo(["a"]);
    frames.flush(); // the "a" loop's first frame runs and queues its next retry
    camera.frameFitTo(["b"]);
    fitToNodes.mockClear();
    frames.flush(); // both the stale "a" retry and the fresh "b" attempt are due this frame

    // Only "b" (the latest call) should have actually queried fitToNodes — the superseded "a"
    // loop must have noticed it lost the race and stopped silently instead of also calling in.
    expect(fitToNodes).toHaveBeenCalledTimes(1);
    expect(fitToNodes).toHaveBeenCalledWith(["b"]);
  });

  it("keeps one stable identity so an effect depending on it does not re-run each render", () => {
    const ref = { current: { fitToNodes: () => true, fitToNode: vi.fn() } as unknown as CanvasViewportHandle };
    const { result, rerender } = renderHook(() => useCanvasCamera(ref));
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
