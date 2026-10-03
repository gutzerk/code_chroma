import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectorStore, useIsInspectorTarget } from "./inspectorStore";
import type { EngineClient } from "../engine-client/EngineClient";

afterEach(() => inspectorStore.reset());

describe("inspectorStore", () => {
  it("is closed until a block opens it", () => {
    expect(inspectorStore.getIsOpen()).toBe(false);
    expect(inspectorStore.getStack()).toEqual([]);
  });

  it("opens on one node and discards any previous drill path", () => {
    inspectorStore.open("dir::src", "Engine");
    inspectorStore.push("component::src/a.py", "a.py");

    inspectorStore.open("dir::web", "Web");

    expect(inspectorStore.getStack()).toEqual([{ id: "dir::web", name: "Web" }]);
  });

  it("drills deeper and returns one level at a time", () => {
    inspectorStore.open("dir::src", "Engine");
    inspectorStore.push("dir::src/graph", "graph");
    inspectorStore.push("component::src/graph/builder.py", "builder.py");

    inspectorStore.back();

    expect(inspectorStore.getStack()).toEqual([
      { id: "dir::src", name: "Engine" },
      { id: "dir::src/graph", name: "graph" },
    ]);
  });

  it("treats re-clicking the row already on top as a no-op, not a duplicate level", () => {
    inspectorStore.open("dir::src", "Engine");

    inspectorStore.push("dir::src", "Engine");

    expect(inspectorStore.getStack()).toHaveLength(1);
  });

  it("closes when the user backs out of the root — there is nothing above it", () => {
    inspectorStore.open("dir::src", "Engine");

    inspectorStore.back();

    expect(inspectorStore.getIsOpen()).toBe(false);
  });

  it("keeps the bound client across a close, so reopening needs no rebind", () => {
    const client = {} as EngineClient;
    inspectorStore.bindClient(client);
    inspectorStore.open("dir::src", "Engine");

    inspectorStore.close();

    expect(inspectorStore.getClient()).toBe(client);
  });

  it("drops the client on reset, so a C1 toggle can't leave a stale one behind", () => {
    inspectorStore.bindClient({} as EngineClient);

    inspectorStore.reset();

    expect(inspectorStore.getClient()).toBeNull();
  });

  it("notifies subscribers on every navigation", () => {
    const listener = vi.fn();
    inspectorStore.subscribe(listener);

    inspectorStore.open("dir::src", "Engine");
    inspectorStore.push("dir::src/graph", "graph");
    inspectorStore.back();

    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("returns a stable stack snapshot so useSyncExternalStore doesn't loop", () => {
    inspectorStore.open("dir::src", "Engine");

    expect(inspectorStore.getStack()).toBe(inspectorStore.getStack());
  });

  it("ignores a rebind of the same client", () => {
    const client = {} as EngineClient;
    const listener = vi.fn();
    inspectorStore.bindClient(client);
    inspectorStore.subscribe(listener);

    inspectorStore.bindClient(client);

    expect(listener).not.toHaveBeenCalled();
  });

  // A caller with no sourceId of its own (the boxes/tree strategy's useNodeChrome) must still match
  // by plain node_id even when the open entry carries a sourceId from whoever opened it.
  it("still matches by node_id for a caller that never passes its own sourceId", () => {
    inspectorStore.open("fn:auth.py:issue", "Auth service", "e1");

    const { result, unmount } = renderHook(() => useIsInspectorTarget("fn:auth.py:issue"));

    expect(result.current).toBe(true);
    unmount();
  });

  it("does not match a different node_id for that same no-sourceId caller", () => {
    inspectorStore.open("fn:auth.py:issue", "Auth service", "e1");

    const { result, unmount } = renderHook(() => useIsInspectorTarget("fn:other.py:other"));

    expect(result.current).toBe(false);
    unmount();
  });

  it("keeps the originally-opened block highlighted while drilling deeper, and clears on open/close", () => {
    inspectorStore.open("component::web/src/canvas/doc/EpicBlockPanel.tsx", "EpicBlockPanel.tsx");
    inspectorStore.push("service::web/src/canvas/doc/EpicBlockPanel.tsx::functions", "Module Functions");
    inspectorStore.push(
      "web/src/canvas/doc/EpicBlockPanel.tsx::function::findChildren",
      "findChildren",
    );

    // The whole drill path stays highlighted — not just the top entry being rendered.
    const { result: deeper, unmount: unmountPath } = renderHook(() =>
      useIsInspectorTarget("component::web/src/canvas/doc/EpicBlockPanel.tsx"),
    );
    expect(deeper.current).toBe(true);
    unmountPath();

    // Opening a different block resets the path, so the old block's highlight clears.
    inspectorStore.open("component::web/src/canvas/RootCanvas.tsx", "RootCanvas.tsx");
    const { result: switched, unmount } = renderHook(() =>
      useIsInspectorTarget("component::web/src/canvas/doc/EpicBlockPanel.tsx"),
    );
    expect(switched.current).toBe(false);
    unmount();
  });
});
