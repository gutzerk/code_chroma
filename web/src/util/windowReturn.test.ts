import { afterEach, describe, expect, it, vi } from "vitest";
import { onWindowReturn } from "./windowReturn";

let stop: () => void = () => {};

afterEach(() => stop());

describe("onWindowReturn", () => {
  it("calls back when the window regains focus", () => {
    const onReturn = vi.fn();
    stop = onWindowReturn(onReturn);

    window.dispatchEvent(new Event("focus"));

    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it("collapses the focus + visibilitychange pair into one call", () => {
    const onReturn = vi.fn();
    stop = onWindowReturn(onReturn, 5_000, () => 1_000);

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it("calls back again once the interval has passed", () => {
    const onReturn = vi.fn();
    let now = 0;
    stop = onWindowReturn(onReturn, 5_000, () => now);
    window.dispatchEvent(new Event("focus"));
    now = 6_000;

    window.dispatchEvent(new Event("focus"));

    expect(onReturn).toHaveBeenCalledTimes(2);
  });

  it("stops listening after cleanup", () => {
    const onReturn = vi.fn();
    onWindowReturn(onReturn)();

    window.dispatchEvent(new Event("focus"));

    expect(onReturn).not.toHaveBeenCalled();
  });
});
