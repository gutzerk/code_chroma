import { describe, expect, it } from "vitest";
import { EMPTY_CANVAS_DOC, type CanvasElement } from "../../state/types";
import {
  LIVE_STAGES,
  STRUCTURAL_STAGES,
  VIEW_STAGES,
  hideAgentQuestions,
  hideCollapsedLayers,
  growExpandedRoutes,
  offsetDraggedElements,
  runDisplayStages,
} from "./displayPipeline";
import { ROUTE_CHILD_LIST_PAD, ROUTE_CHILD_ROW_HEIGHT } from "./routeExpansion";

function box(id: string, y: number, opts: { children?: number; layer?: string } = {}): CanvasElement {
  const { children = 0, layer = "custom/flow" } = opts;
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

const EXTRA = 2 * ROUTE_CHILD_ROW_HEIGHT + ROUTE_CHILD_LIST_PAD;

describe("display pipeline", () => {
  it("runs the groups in filter, grow, drag, view order", () => {
    const order = [...STRUCTURAL_STAGES, ...LIVE_STAGES, ...VIEW_STAGES];

    expect(order.slice(0, 4)).toEqual([hideAgentQuestions, hideCollapsedLayers, growExpandedRoutes, offsetDraggedElements]);
    expect(order).toHaveLength(5);
  });

  it("hides questions an agent asked but keeps those without an agent id", () => {
    const question = (id: string, agentId: unknown): CanvasElement => ({
      ...box(id, 100, { layer: "questions" }), render: "question", meta: { state: "open", agent_id: agentId },
    });
    const elements = { a: question("a", "agent-1"), b: question("b", ""), c: question("c", undefined), d: box("d", 300) };

    const out = runDisplayStages(STRUCTURAL_STAGES, elements, {});

    expect(Object.keys(out).sort()).toEqual(["b", "c", "d"]);
  });

  it("returns the same map when no stage has work", () => {
    const elements = { a: box("a", 100) };

    const out = runDisplayStages([...STRUCTURAL_STAGES, ...LIVE_STAGES, ...VIEW_STAGES], elements, {});

    expect(out).toBe(elements);
  });

  it("applies a drag offset on top of the position an expanded step pushed", () => {
    const elements = { a: box("a", 100, { children: 2 }), b: box("b", 300) };
    const ctx = { routeExpanded: new Set(["a"]), dragOffsets: { b: { x: 0, y: 50 } } };

    const grown = runDisplayStages(STRUCTURAL_STAGES, elements, ctx);
    const out = runDisplayStages(LIVE_STAGES, grown, ctx);

    expect(out.b.position.y).toBe(300 + EXTRA + 50);
  });

  it("does not let a collapsed layer's box be pushed or pushing", () => {
    const elements = {
      a: box("a", 100, { children: 2 }),
      hidden: box("hidden", 300, { layer: "custom/other" }),
      b: box("b", 300),
    };

    const out = runDisplayStages(STRUCTURAL_STAGES, elements, {
      collapsedLayers: new Set(["custom/other"]),
      routeExpanded: new Set(["a"]),
    });

    expect(Object.keys(out).sort()).toEqual(["a", "b"]);
    expect(out.b.position.y).toBe(300 + EXTRA);
  });

  it("ignores an expanded step whose layer is collapsed", () => {
    const elements = { a: box("a", 100, { children: 2 }), b: box("b", 300) };

    const out = runDisplayStages(STRUCTURAL_STAGES, elements, {
      collapsedLayers: new Set(["custom/flow"]),
      routeExpanded: new Set(["a"]),
    });

    expect(out).toEqual({});
  });

  it("replaces each board layer's elements with its profile view, leaving other layers alone", () => {
    const elements = { a: box("a", 100, { layer: "board" }), b: box("b", 300) };
    const doc = { ...EMPTY_CANVAS_DOC, elements };

    const out = runDisplayStages(VIEW_STAGES, elements, {
      boards: { doc, layers: [{ layer: "board", ids: ["a"], view: (d, ids) => ids.map((id) => ({ ...d.elements[id], position: { x: 0, y: 0 } })) }] },
    });

    expect([out.a.position, out.b]).toEqual([{ x: 0, y: 0 }, elements.b]);
  });
});
