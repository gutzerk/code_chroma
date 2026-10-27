import { describe, expect, it } from "vitest";
import { expandRouteElements, expandedExtraHeight } from "./routeExpansion";
import { routeStepOf } from "./routeStep";
import type { CanvasElement } from "../../state/types";

function box(id: string, y: number, children = 0, layer = "custom/flow"): CanvasElement {
  return {
    id, render: "custom", layer, label: id, description: "", node_id: null,
    position: { x: 200, y }, size: { w: 300, h: 72 }, group_id: null, created_by: "ai",
    meta: {
      route_step: {
        id, order: 1, kind: "ai", node_ids: [],
        children: Array.from({ length: children }, (_, i) => ({ id: `c${i}`, label: `f${i}()`, line: i + 1 })),
      },
    },
  };
}

describe("expandRouteElements", () => {
  it("returns the same map when nothing is expanded", () => {
    const elements = { a: box("a", 100, 2) };

    expect(expandRouteElements(elements, new Set())).toBe(elements);
  });

  it("grows the expanded step downward and pushes the box below it", () => {
    const elements = { a: box("a", 100, 2), b: box("b", 300) };
    const extra = expandedExtraHeight(2);

    const next = expandRouteElements(elements, new Set(["a"]));

    expect(next.a.size?.h).toBe(72 + extra);
    expect(next.a.position.y).toBe(100 + extra / 2);
    expect(next.b.position.y).toBe(300 + extra);
  });

  it("leaves boxes above, beside and in other layers alone", () => {
    const elements = {
      a: box("a", 300, 1),
      above: box("above", 100),
      beside: { ...box("beside", 400), position: { x: 900, y: 400 } },
      other: box("other", 400, 0, "custom/other"),
    };

    const next = expandRouteElements(elements, new Set(["a"]));

    expect(next.above.position.y).toBe(100);
    expect(next.beside.position.y).toBe(400);
    expect(next.other.position.y).toBe(400);
  });

  it("ignores an expanded id whose step has no children", () => {
    const elements = { a: box("a", 100, 0), b: box("b", 300) };

    expect(expandRouteElements(elements, new Set(["a"])).b.position.y).toBe(300);
  });
});

describe("routeStepOf", () => {
  it("drops children without a positive line and defaults an unknown kind", () => {
    const el = box("a", 0);
    el.meta = { route_step: { id: "a", kind: "wat", children: [{ label: "x", line: 0 }, { label: "y", line: 3 }] } };

    const step = routeStepOf(el);

    expect(step?.kind).toBe("decide");
    expect(step?.children).toEqual([{ id: "y", label: "y", nodeId: undefined, line: 3 }]);
  });
});
