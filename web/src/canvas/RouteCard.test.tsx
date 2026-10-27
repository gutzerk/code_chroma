import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RouteCard, ROUTE_WALK_STEP_MS } from "./RouteCard";
import { routeStore } from "../state/routeStore";
import type { Route } from "./doc/routeStep";

const step = (id: string, order: number, kind: "trigger" | "failure") => ({ id, order, title: `Step ${id}`, kind, nodeIds: [], children: [] });
const ROUTE: Route = {
  id: "r", title: "Update the map", summary: "2 steps · 0 files · 0 AI steps",
  steps: [step("a", 1, "trigger"), step("b", 2, "failure")],
};

afterEach(() => {
  routeStore.reset();
  vi.useRealTimers();
});

describe("RouteCard", () => {
  it("renders nothing without a route", () => {
    render(<RouteCard />);

    expect(screen.queryByTestId("route-card")).toBeNull();
  });

  it("lists the steps with the derived summary and marks a failure with a cross", () => {
    routeStore.show(ROUTE);

    render(<RouteCard />);

    expect(screen.getByTestId("route-card-summary").textContent).toBe(ROUTE.summary);
    const rows = screen.getAllByTestId("route-card-step");
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain("✕");
  });

  it("walks the route on a timer and stops at the last step", () => {
    vi.useFakeTimers();
    routeStore.show(ROUTE);
    render(<RouteCard />);

    fireEvent.click(screen.getByTestId("route-walk"));
    act(() => void vi.advanceTimersByTime(ROUTE_WALK_STEP_MS));

    expect(routeStore.getSnapshot()).toMatchObject({ stepIndex: 1, walking: false });
  });
});
