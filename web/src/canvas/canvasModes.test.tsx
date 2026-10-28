import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { routeStore } from "../state/routeStore";
import { CANVAS_MODES, useActiveModes } from "./canvasModes";

describe("canvas modes", () => {
  afterEach(() => routeStore.reset());

  it("keeps the route probe always on and adds the route mode once a route is shown", () => {
    const { result } = renderHook(() => useActiveModes());
    expect(result.current.map((mode) => mode.id)).toEqual(["route-probe"]);

    act(() => routeStore.show({ id: "r", title: "R", summary: "", steps: [] }));

    expect(result.current.map((mode) => mode.id)).toEqual(["route-probe", "route"]);
    expect(result.current[1]).toBe(CANVAS_MODES[3]);
    expect(result.current[1].Overlay).toBeDefined();
    expect(result.current[1].Controls).toBeDefined();
  });
});
