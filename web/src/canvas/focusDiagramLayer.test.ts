import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collapsedLayersStore } from "./doc/collapsedLayersStore";
import { FOCUS_DIAGRAM_MAX_FRAMES, focusDiagramLayer } from "./focusDiagramLayer";

const SELECTOR = '[data-diagram-layer="patterns"]';

/** Drains rAF callbacks by hand, so the retry loop can be stepped one frame at a time. */
function frameQueue() {
  let pending: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  return {
    flush(times = 1) {
      for (let i = 0; i < times; i += 1) {
        const due = pending;
        pending = [];
        for (const callback of due) callback(0);
      }
    },
  };
}

/** Mounts a stand-in diagram frame with a fixed layout size. */
function mountFrame(width: number): HTMLElement {
  const frame = document.createElement("div");
  frame.dataset.diagramLayer = "patterns";
  Object.defineProperty(frame, "offsetWidth", { configurable: true, value: width });
  document.body.append(frame);
  return frame;
}

let frames: ReturnType<typeof frameQueue>;

beforeEach(() => {
  frames = frameQueue();
  collapsedLayersStore.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("focusDiagramLayer", () => {
  it("shows a hidden layer before framing it", () => {
    collapsedLayersStore.collapse("patterns");

    focusDiagramLayer("patterns", () => true, () => false);

    expect(collapsedLayersStore.isCollapsed("patterns")).toBe(false);
  });

  it("waits for the frame to mount, then fits it once its size holds for a frame", () => {
    const fit = vi.fn(() => true);
    focusDiagramLayer("patterns", fit, () => false);
    frames.flush(2);
    mountFrame(100);

    frames.flush(2);

    expect(fit).toHaveBeenCalledTimes(1);
    expect(fit).toHaveBeenCalledWith(SELECTOR);
  });

  it("does not fit while the frame is still resizing", () => {
    const fit = vi.fn(() => true);
    const frame = mountFrame(100);
    focusDiagramLayer("patterns", fit, () => false);
    frames.flush();
    Object.defineProperty(frame, "offsetWidth", { configurable: true, value: 180 });

    frames.flush();

    expect(fit).not.toHaveBeenCalled();
  });

  it("stops once a newer focus cancels it", () => {
    const fit = vi.fn(() => true);
    let cancelled = false;
    focusDiagramLayer("patterns", fit, () => cancelled);
    cancelled = true;
    mountFrame(100);

    frames.flush(3);

    expect(fit).not.toHaveBeenCalled();
  });

  it("fits once at the frame cap even if the frame never mounts", () => {
    const fit = vi.fn(() => false);
    focusDiagramLayer("patterns", fit, () => false);

    frames.flush(FOCUS_DIAGRAM_MAX_FRAMES + 1);

    expect(fit).toHaveBeenCalledTimes(1);
  });
});
