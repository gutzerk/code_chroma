import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RouteCard, collectRoutes, ROUTE_WALK_STEP_MS } from "./RouteCard";
import { canvasDocStore } from "./doc/canvasDocStore";
import { routeStore } from "../state/routeStore";
import { routeFor, type Route } from "./doc/routeStep";

const step = (id: string, order: number, kind: "trigger" | "failure") => ({ id, order, title: `Step ${id}`, kind, nodeIds: [], children: [] });
const ROUTE: Route = {
  id: "r", title: "Update the map", summary: "2 steps · 0 files · 0 AI steps",
  steps: [step("a", 1, "trigger"), step("b", 2, "failure")],
};

afterEach(() => {
  routeStore.reset();
  canvasDocStore.reset();
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

  it("shows no picker for a single route", () => {
    routeStore.show(ROUTE);

    render(<RouteCard />);

    expect(screen.queryByTestId("route-picker")).toBeNull();
  });
});

describe("route picker", () => {
  const other: Route = { ...ROUTE, id: "r2", title: "Other route" };
  const el = (id: string, route: Route) => ({ [id]: { id, meta: { route } } as never });

  it("collects each distinct route once", () => {
    const elements = { ...el("1", ROUTE), ...el("2", ROUTE), ...el("3", other) };

    expect(collectRoutes(elements).map((r) => r.id)).toEqual(["r", "r2"]);
  });

  it("reads a route from a carrier and a box that holds only a route_id", () => {
    const carrier = { id: "c", layer: "l", render: "route", meta: { route_id: "r", route: ROUTE } } as never;
    const box = { id: "1", layer: "l", render: "custom", meta: { route_id: "r" } } as never;

    const routes = collectRoutes({ 1: box }, [carrier]);

    expect(routes.map((r) => r.id)).toEqual(["r"]);
    expect(routeFor(box, [carrier])?.title).toBe("Update the map");
  });

  it("switches the active route when another is picked", () => {
    act(() => {
      canvasDocStore.setDoc({ ...canvasDocStore.getDoc(), elements: { ...el("1", ROUTE), ...el("3", other) } });
    });
    routeStore.show(ROUTE);
    render(<RouteCard />);

    fireEvent.change(screen.getByTestId("route-picker"), { target: { value: "r2" } });

    expect(routeStore.getSnapshot().route?.id).toBe("r2");
  });
});
