import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { canvasDocStore, patchCanvasDoc, useLoadCanvasDoc } from "./canvasDocStore";
import { EMPTY_CANVAS_DOC, type CanvasDoc } from "../../state/types";
import type { EngineClient } from "../../engine-client/EngineClient";

const ELEMENT = {
  id: "a",
  render: "c1" as const,
  layer: "c1",
  label: "",
  description: "",
  node_id: null,
  position: { x: 0, y: 0 },
  size: null,
  group_id: null,
  meta: {},
  created_by: "ai" as const,
};

function docWithLabel(label: string): CanvasDoc {
  return { ...EMPTY_CANVAS_DOC, elements: { a: { ...ELEMENT, label } } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

afterEach(() => {
  canvasDocStore.reset();
});

describe("canvasDocStore fetch race", () => {
  it("a slower, now-stale getCanvas() response never overwrites a newer one that already applied", async () => {
    // Call 0: the mount's own initial fetch. Call 1: a "changed" ping firing right after, issued
    // later but resolving first -- the real-network case this guards against.
    const responses = [deferred<CanvasDoc>(), deferred<CanvasDoc>()];
    let call = 0;
    let triggerChanged: () => void = () => {};
    const client = {
      getCanvas: () => responses[call++].promise,
      subscribeCanvas: () => () => {},
      subscribe: (cb: () => void) => {
        triggerChanged = cb;
        return () => {};
      },
    } as unknown as EngineClient;
    renderHook(() => useLoadCanvasDoc(client));
    triggerChanged();

    responses[1].resolve(docWithLabel("second"));
    await Promise.resolve();
    await Promise.resolve();
    responses[0].resolve(docWithLabel("first"));
    await Promise.resolve();
    await Promise.resolve();

    expect(canvasDocStore.getDoc().elements.a.label).toBe("second");
  });

  it("patchCanvasDoc's own refetch (the latest-issued one) wins even over a slower concurrent refetch issued just before it", async () => {
    // Call 0: mount's own initial fetch (irrelevant here, resolved immediately). Call 1: a
    // "changed" ping's refetch, in flight when the drag commits. Call 2: patchCanvasDoc's own
    // post-write refetch, issued after call 1 but resolving before it.
    const mountFetch = deferred<CanvasDoc>();
    const changedPing = deferred<CanvasDoc>();
    const patchRefetch = deferred<CanvasDoc>();
    const responses = [mountFetch, changedPing, patchRefetch];
    let call = 0;
    let triggerChanged: () => void = () => {};
    const client = {
      getCanvas: () => responses[call++].promise,
      subscribeCanvas: () => () => {},
      subscribe: (cb: () => void) => {
        triggerChanged = cb;
        return () => {};
      },
      patchCanvas: async () => ({ ok: true, affected: [], errors: [], new_elements: {} }),
    } as unknown as EngineClient;
    renderHook(() => useLoadCanvasDoc(client));
    mountFetch.resolve(EMPTY_CANVAS_DOC);
    await Promise.resolve();
    await Promise.resolve();
    triggerChanged();
    const commit = patchCanvasDoc(client, []);

    patchRefetch.resolve(docWithLabel("patched"));
    await commit;
    changedPing.resolve(docWithLabel("stale-changed-ping"));
    await Promise.resolve();
    await Promise.resolve();

    expect(canvasDocStore.getDoc().elements.a.label).toBe("patched");
  });
});

describe("deferred layout layers", () => {
  it("releaseLayout drops only its own layer, keeping a concurrent one withheld", () => {
    canvasDocStore.deferLayout("epics");
    canvasDocStore.deferLayout("c1");

    canvasDocStore.releaseLayout("epics");

    // The other layer is still mid-layout, so fetchAndApplyCanvasDoc must keep withholding it.
    expect(canvasDocStore.layersMidLayout()).toEqual(["c1"]);
  });

  it("releasing a layer never deferred is a no-op", () => {
    canvasDocStore.deferLayout("c1");

    canvasDocStore.releaseLayout("epics");
    canvasDocStore.releaseLayout("c1");

    expect(canvasDocStore.layersMidLayout()).toEqual([]);
  });
});
