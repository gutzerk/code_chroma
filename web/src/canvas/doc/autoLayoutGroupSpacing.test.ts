import { describe, expect, it } from "vitest";
import { layoutNewElements } from "./autoLayout";
import { AUTO_NODE_SEP, AUTO_RANK_SEP } from "../collision/constants";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type CanvasElement, type CanvasPosition } from "../../state/types";

const LAYER = "custom/patterns-llm";
// Real rendered height (Playwright, full zoom) of a code-backed role box: role row, name, description, path, members, SRC.
const REAL_MEMBER_H = 195;

function member(id: string, overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    render: "custom",
    layer: LAYER,
    label: id,
    description: "Command line and flags for the adapter.",
    node_id: `class::${id}`,
    position: { x: 0, y: 0 },
    size: null,
    group_id: "g",
    meta: { path: "src/codechroma/llm/cli_adapters.py" },
    created_by: "ai",
    ...overrides,
  };
}

function docWith(elements: CanvasElement[], links: Array<[string, string]>): CanvasDoc {
  return {
    ...EMPTY_CANVAS_DOC,
    elements: Object.fromEntries(elements.map((e) => [e.id, e])),
    edges: Object.fromEntries(
      links.map(([from, to]) => [`${from}-${to}`, { id: `${from}-${to}`, from, to, label: "", kind: "implements", layer: LAYER }]),
    ),
  };
}

/** The real rendered rect of a member centred at `p`, whatever its stored size says. */
function realRect(p: CanvasPosition) {
  const w = 300;
  const h = REAL_MEMBER_H;
  return { x0: p.x - w / 2, y0: p.y - h / 2, x1: p.x + w / 2, y1: p.y + h / 2 };
}

/** True when two rects keep at least the auto-layout gap on X or on Y. */
function clear(a: ReturnType<typeof realRect>, b: ReturnType<typeof realRect>): boolean {
  const gapX = Math.max(a.x0 - b.x1, b.x0 - a.x1);
  const gapY = Math.max(a.y0 - b.y1, b.y0 - a.y1);
  return gapX >= AUTO_NODE_SEP || gapY >= AUTO_RANK_SEP;
}

describe("layoutNewElements spacing inside a group", () => {
  it("keeps every member of a fresh group clear of the others by the minimum gap", async () => {
    const ids = ["iface", "impl1", "impl2", "impl3"];
    const doc = docWith(ids.map((id) => member(id)), [["impl1", "iface"], ["impl2", "iface"], ["impl3", "iface"]]);

    const { positions } = await layoutNewElements(doc, ids);

    const rects = ids.map((id) => realRect(positions[id]));
    const crowded = rects.flatMap((a, i) => rects.slice(i + 1).filter((b) => !clear(a, b)));
    expect(crowded).toEqual([]);
  });

  it("places a new member clear of a box already sitting where it would land", async () => {
    const placed = [member("iface", { size: { w: 300, h: 103 } }), member("blocker", { layer: "other", position: { x: 0, y: -300 } })];
    const doc = docWith([...placed, member("impl")], [["impl", "iface"]]);

    const { positions } = await layoutNewElements(doc, ["impl"]);

    const added = realRect(positions.impl);
    const crowded = placed.filter((p) => !clear(added, realRect(p.position)));
    expect(crowded).toEqual([]);
  });
});
