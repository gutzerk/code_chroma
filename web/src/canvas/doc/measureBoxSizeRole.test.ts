import { describe, expect, it } from "vitest";
import { layoutBoxSize, measureBoxSize } from "./measureBoxSize";
import type { CanvasElement } from "../../state/types";

// Real rendered heights (Playwright, full zoom) of the role boxes on the "Patterns: LLM and agents" diagram.
const REAL_CODE_BOX_H = 195;
const REAL_EXTERNAL_BOX_H = 117;

function el(overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: "a",
    render: "custom",
    layer: "custom/patterns-llm",
    label: "CliAdapter",
    description: "Protocol for launching one agent CLI.",
    node_id: null,
    position: { x: 0, y: 0 },
    size: null,
    group_id: null,
    meta: {},
    created_by: "ai",
    ...overrides,
  };
}

const codeBox = (overrides: Partial<CanvasElement> = {}) =>
  el({ node_id: "class::cli", meta: { path: "src/codechroma/llm/cli_adapters.py" }, ...overrides });

describe("measureBoxSize on a role box", () => {
  it("reserves the real height of a box with role row, description, path, members and SRC", () => {
    const box = codeBox();

    const result = measureBoxSize(box);

    expect(result!.h).toBeGreaterThanOrEqual(REAL_CODE_BOX_H);
    expect(result!.h).toBeLessThan(REAL_CODE_BOX_H + 24);
  });

  it("reserves the real height of an external box with no code behind it", () => {
    const box = el({ label: "Agent CLI process", meta: { no_code_reason: "external" } });

    const result = measureBoxSize(box);

    expect(result!.h).toBeGreaterThanOrEqual(REAL_EXTERNAL_BOX_H);
    expect(result!.h).toBeLessThan(REAL_EXTERNAL_BOX_H + 24);
  });

  it("adds a name line when a long label wraps", () => {
    const short = el({ meta: { no_code_reason: "conceptual" } });
    const long = el({ label: "Strategy — diagram context providers and more", meta: { no_code_reason: "conceptual" } });

    const a = measureBoxSize(short);
    const b = measureBoxSize(long);

    expect(b!.h).toBeGreaterThan(a!.h);
  });

  it.each([
    ["role", { kind: "api" }],
    ["plain", {}],
  ])("reserves only the band's padding for an order-only top band on a %s box", (_kind, meta) => {
    const plain = el({ meta });
    const ordered = el({ meta: { ...meta, order: "1" } });

    const delta = measureBoxSize(ordered)!.h - measureBoxSize(plain)!.h;

    expect(delta).toBeGreaterThanOrEqual(9);
    expect(delta).toBeLessThanOrEqual(11);
  });

  it("reserves a full text row for a plan_kind top band", () => {
    const plain = el({ meta: { kind: "api" } });
    const planned = el({ meta: { kind: "api", plan_kind: "modify" } });

    const delta = measureBoxSize(planned)!.h - measureBoxSize(plain)!.h;

    expect(delta).toBeGreaterThanOrEqual(21);
    expect(delta).toBeLessThanOrEqual(23);
  });
});

describe("layoutBoxSize", () => {
  it("grows a role box's stale stored height to its content", () => {
    const box = codeBox({ size: { w: 300, h: 103 } });

    const result = layoutBoxSize(box);

    expect(result).toEqual({ w: 300, h: measureBoxSize(codeBox())!.h });
  });

  it("keeps a stored height taller than the content", () => {
    const box = codeBox({ size: { w: 300, h: 400 } });

    const result = layoutBoxSize(box);

    expect(result).toEqual({ w: 300, h: 400 });
  });

  it("keeps a plain box's authored size", () => {
    const box = el({ layer: "x", size: { w: 410, h: 50 } });

    const result = layoutBoxSize(box);

    expect(result).toEqual({ w: 410, h: 50 });
  });
});
