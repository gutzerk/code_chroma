import { describe, expect, it } from "vitest";
import { classifyWheel, createWheelClassifier, pinchZoomFactor, wheelZoomFactor } from "./wheelInput";

const DEFAULTS = { mouse: 1, trackpad: 1 };

describe("classifyWheel", () => {
  it.each([
    ["pinch (ctrlKey)", { deltaY: 3, deltaX: 0, deltaMode: 0, ctrlKey: true }, "trackpad"],
    ["Firefox line mode", { deltaY: 3, deltaX: 0, deltaMode: 1, ctrlKey: false }, "mouse"],
    ["120-step wheelDelta", { deltaY: 4, deltaX: 0, deltaMode: 0, ctrlKey: false, wheelDeltaY: -120 }, "mouse"],
    ["fine wheelDelta", { deltaY: 2.5, deltaX: 0, deltaMode: 0, ctrlKey: false, wheelDeltaY: -7 }, "trackpad"],
    ["Windows notch, no legacy delta", { deltaY: 100, deltaX: 0, deltaMode: 0, ctrlKey: false }, "mouse"],
    ["fractional pixels", { deltaY: 1.5, deltaX: 0.5, deltaMode: 0, ctrlKey: false }, "trackpad"],
    ["trackpad 40px (legacy = 3x pixels)", { deltaY: 40, deltaX: 0, deltaMode: 0, ctrlKey: false, wheelDeltaY: -120 }, "trackpad"],
    ["WebKit notch (legacy = 3x of 100px)", { deltaY: 100, deltaX: 0, deltaMode: 0, ctrlKey: false, wheelDeltaY: -300 }, "mouse"],
    ["Windows 125% notch", { deltaY: 125, deltaX: 0, deltaMode: 0, ctrlKey: false, wheelDeltaY: -120 }, "mouse"],
  ] as const)("%s → %s", (_name, event, expected) => {
    const device = classifyWheel(event);

    expect(device).toBe(expected);
  });
});

describe("createWheelClassifier", () => {
  it("keeps a trackpad stream on trackpad when one event looks like a mouse notch", () => {
    let t = 0;
    const classify = createWheelClassifier(() => t);
    classify({ deltaY: 2.5, deltaX: 0, deltaMode: 0, ctrlKey: false });
    t = 16;

    const device = classify({ deltaY: 100, deltaX: 0, deltaMode: 0, ctrlKey: false });

    expect(device).toBe("trackpad");
  });

  it("reads a mouse notch as mouse once the trackpad stream has ended", () => {
    let t = 0;
    const classify = createWheelClassifier(() => t);
    classify({ deltaY: 2.5, deltaX: 0, deltaMode: 0, ctrlKey: false });
    t = 1000;

    const device = classify({ deltaY: 100, deltaX: 0, deltaMode: 0, ctrlKey: false });

    expect(device).toBe("mouse");
  });
});

describe("pinchZoomFactor", () => {
  it("zooms by the ratio between gesture steps, raised to the sensitivity", () => {
    const factor = pinchZoomFactor(1.2, 1.44, 2);

    expect(factor).toBeCloseTo(1.44, 5);
  });

  it("ignores a broken scale", () => {
    const factor = pinchZoomFactor(0, 1.5, 1);

    expect(factor).toBe(1);
  });
});

describe("wheelZoomFactor", () => {
  it("counts notches from the legacy 120-step delta, so Windows display scaling doesn't change the step", () => {
    const at100 = wheelZoomFactor({ deltaY: -100, deltaX: 0, deltaMode: 0, ctrlKey: false, wheelDeltaY: 120 }, DEFAULTS);
    const at150 = wheelZoomFactor({ deltaY: -150, deltaX: 0, deltaMode: 0, ctrlKey: false, wheelDeltaY: 120 }, DEFAULTS);

    expect(at150).toBe(at100);
  });

  it("zooms one mouse notch by the same step whether the OS reports 100px or 3 lines", () => {
    const windowsNotch = wheelZoomFactor({ deltaY: -100, deltaX: 0, deltaMode: 0, ctrlKey: false }, DEFAULTS);
    const firefoxNotch = wheelZoomFactor({ deltaY: -3, deltaX: 0, deltaMode: 1, ctrlKey: false }, DEFAULTS);

    expect(windowsNotch).toBeCloseTo(1.197, 2);
    expect(firefoxNotch).toBe(windowsNotch);
  });

  it("caps a huge trackpad burst instead of jumping several times in one event", () => {
    const factor = wheelZoomFactor({ deltaY: -500, deltaX: 0, deltaMode: 0, ctrlKey: true }, DEFAULTS);

    expect(factor).toBeCloseTo(Math.exp(16 * 0.0128), 5);
  });

  it("scales the step with the per-device sensitivity", () => {
    const event = { deltaY: -100, deltaX: 0, deltaMode: 0, ctrlKey: false };

    const slow = wheelZoomFactor(event, { mouse: 0.5, trackpad: 1 });
    const fast = wheelZoomFactor(event, { mouse: 2, trackpad: 1 });

    expect(Math.log(fast) / Math.log(slow)).toBeCloseTo(4, 5);
  });

  it("zooms out for a positive delta", () => {
    const factor = wheelZoomFactor({ deltaY: 100, deltaX: 0, deltaMode: 0, ctrlKey: false }, DEFAULTS);

    expect(factor).toBeLessThan(1);
  });
});

