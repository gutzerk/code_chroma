import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMeasuredSizes } from "./useMeasuredSizes";

/** jsdom has no ResizeObserver, so unobserve/disconnect calls are unreachable without a fake one. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(_callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
}

const original = globalThis.ResizeObserver;

beforeEach(() => {
  FakeResizeObserver.instances = [];
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = original;
});

describe("useMeasuredSizes", () => {
  it("unobserves and forgets an element once its box unmounts", () => {
    const { result } = renderHook(() => useMeasuredSizes());
    const element = document.createElement("div");

    result.current.observe("box-1", element);
    result.current.observe("box-1", null);

    const observer = FakeResizeObserver.instances[0];
    expect(observer.observe).toHaveBeenCalledWith(element);
    expect(observer.unobserve).toHaveBeenCalledWith(element);
  });

  it("does not unobserve when the same element is re-observed under the same id", () => {
    const { result } = renderHook(() => useMeasuredSizes());
    const element = document.createElement("div");

    result.current.observe("box-1", element);
    result.current.observe("box-1", element);

    const observer = FakeResizeObserver.instances[0];
    expect(observer.unobserve).not.toHaveBeenCalled();
  });

  it("unobserves the old element when a different one takes over the same id", () => {
    const { result } = renderHook(() => useMeasuredSizes());
    const first = document.createElement("div");
    const second = document.createElement("div");

    result.current.observe("box-1", first);
    result.current.observe("box-1", second);

    const observer = FakeResizeObserver.instances[0];
    expect(observer.unobserve).toHaveBeenCalledWith(first);
    expect(observer.observe).toHaveBeenCalledWith(second);
  });
});
