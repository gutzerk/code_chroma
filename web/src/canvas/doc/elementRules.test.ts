import { describe, expect, it } from "vitest";
import type { CanvasRenderKind } from "../../state/types";
import {
  BLOCK_RULES,
  NODE_STYLES,
  type NodeStyleEntry,
  type RendererKind,
} from "./elementRules";

const ALL_KINDS: CanvasRenderKind[] = [
  "hierarchy",
  "c1",
  "pattern",
  "impact",
  "epic",
  "spec",
  "task",
  "custom",
  "group",
  "note",
  "sequence",
];

/** Image of how each kind must land in the registry — every `renderer` that used to be decided by
 * CanvasDocView's if-chain and every per-kind delta (impact→overlay+status chip, epic→epic-brief)
 * pinned here so a future kind can't silently default to the wrong behavior. */
const EXPECTED: Record<CanvasRenderKind, { renderer: RendererKind; overlay?: "impact"; statusChip?: "impact"; activation: string }> = {
  hierarchy: { renderer: "hierarchy", activation: "inspector" },
  c1: { renderer: "node-box", activation: "inspector" },
  pattern: { renderer: "node-box", activation: "inspector" },
  impact: { renderer: "node-box", activation: "inspector", overlay: "impact", statusChip: "impact" },
  epic: { renderer: "node-box", activation: "epic-brief" },
  spec: { renderer: "node-box", activation: "epic-brief" },
  task: { renderer: "node-box", activation: "inspector" },
  custom: { renderer: "node-box", activation: "inspector" },
  group: { renderer: "group", activation: "inspector" },
  note: { renderer: "note", activation: "inspector" },
  sequence: { renderer: "sequence", activation: "inspector" },
};

describe("BLOCK_RULES", () => {
  it("covers every CanvasRenderKind exactly once", () => {
    expect(Object.keys(BLOCK_RULES).sort()).toEqual([...ALL_KINDS].sort());
  });

  it("maps each kind to its expected renderer and per-kind deltas", () => {
    for (const kind of ALL_KINDS) {
      const rule = BLOCK_RULES[kind];
      expect(rule.renderer).toBe(EXPECTED[kind].renderer);
      expect(rule.overlay).toBe(EXPECTED[kind].overlay);
      expect(rule.statusChip).toBe(EXPECTED[kind].statusChip);
      expect(rule.activation).toBe(EXPECTED[kind].activation);
    }
  });

  it("locks layout on the epic, spec and task kinds (hard-layout brief; 010-epics-tree-render Part 4)", () => {
    expect(BLOCK_RULES.epic.lockedLayout).toBe(true);
    expect(BLOCK_RULES.spec.lockedLayout).toBe(true);
    // task boxes are fixed too (user-confirmed full task graph).
    expect(BLOCK_RULES.task.lockedLayout).toBe(true);
    // A sequence layer positions from meta (own-component), never by user drag.
    expect(BLOCK_RULES.sequence.lockedLayout).toBe(true);
    for (const kind of ALL_KINDS) {
      if (kind === "epic" || kind === "spec" || kind === "task" || kind === "sequence") continue;
      expect(BLOCK_RULES[kind].lockedLayout).toBeFalsy();
    }
  });
});

/** Folded in from the retired `nodeStyles.test.tsx` — the style registry moved into BLOCK_RULES, so
 * these guards now assert the style strings live on the rules rather than in a parallel file. */
const SHARED_BASE: NodeStyleEntry = {
  boxClass: "diagram-node-box",
  rowClass: "diagram-node-box-row block-row",
  headerClass: "diagram-node-box-header",
  titleWrapClass: "diagram-node-box-title-wrap",
  titleRowClass: "diagram-node-box-title-row",
  nameClass: "diagram-node-box-name",
  descClass: "diagram-node-box-desc",
  draggingClass: "diagram-node-box--dragging",
};

const C1: NodeStyleEntry = {
  boxClass: "block block-c1-system",
  rowClass: "block-row",
  headerClass: "block-header",
  titleWrapClass: "block-title",
  titleRowClass: "block-name-row",
  nameClass: "block-name",
  descClass: "block-description",
  draggingClass: "c1-node-anchor--dragging",
};

describe("NODE_STYLES (from BLOCK_RULES)", () => {
  it("gives pattern/impact/custom the shared diagram-node-box entry", () => {
    expect(NODE_STYLES.pattern).toEqual(SHARED_BASE);
    expect(NODE_STYLES.impact).toEqual(SHARED_BASE);
    expect(NODE_STYLES.custom).toEqual(SHARED_BASE);
  });

  it("gives epic the full shared entry so the epic brief text renders under the title", () => {
    expect(NODE_STYLES.epic).toEqual(SHARED_BASE);
  });

  it("keeps c1 on its own Block-mirroring classes", () => {
    expect(NODE_STYLES.c1).toEqual(C1);
  });

  it("backs every NODE_STYLES entry with a BLOCK_RULES.style", () => {
    for (const [kind, entry] of Object.entries(NODE_STYLES)) {
      expect(BLOCK_RULES[kind as CanvasRenderKind].style).toEqual(entry);
    }
  });

  it("leaves no style on kinds that render through their own components", () => {
    for (const kind of ["hierarchy", "note", "group"] as const) {
      expect(BLOCK_RULES[kind].style).toBeUndefined();
    }
  });
});
