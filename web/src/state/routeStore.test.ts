import { afterEach, describe, expect, it } from "vitest";
import { routeStore } from "./routeStore";
import type { Route } from "../canvas/doc/routeStep";

const step = (id: string, order: number) => ({ id, order, title: id, kind: "decide" as const, nodeIds: [], children: [] });
const ROUTE: Route = { id: "r", title: "T", summary: "3 steps", steps: [step("a", 1), step("b", 2), step("c", 3)] };

afterEach(() => routeStore.reset());

describe("routeStore", () => {
  it("shows a route before the walk starts", () => {
    routeStore.show(ROUTE);

    expect(routeStore.getSnapshot()).toMatchObject({ route: ROUTE, stepIndex: -1, walking: false });
  });

  it("walks step by step and stops itself on the last step", () => {
    routeStore.show(ROUTE);

    routeStore.toggleWalk();
    routeStore.advance();
    routeStore.advance();

    expect(routeStore.getSnapshot()).toMatchObject({ stepIndex: 2, walking: false });
  });

  it("clamps setStep to the route and restarts a finished walk", () => {
    routeStore.show(ROUTE);
    routeStore.setStep(99);

    routeStore.toggleWalk();

    expect(routeStore.getSnapshot()).toMatchObject({ stepIndex: 0, walking: true });
  });

  it("clears back to no route", () => {
    routeStore.show(ROUTE);

    routeStore.clear();

    expect(routeStore.getSnapshot().route).toBeNull();
  });
});
