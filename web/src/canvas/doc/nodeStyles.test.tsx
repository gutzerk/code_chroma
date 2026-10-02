import { describe, expect, it } from "vitest";
import { NODE_STYLES } from "./nodeStyles";

/** 036-shared-diagram-style-catalog: pattern/impact/custom/epic now render through one shared
 * `.diagram-node-box*` class family instead of five near-duplicate per-kind ones -- this guard
 * checks the collapse landed, not that each kind kept its own bespoke classes. */
describe("NODE_STYLES", () => {
  const SHARED_BASE = {
    boxClass: "diagram-node-box",
    rowClass: "diagram-node-box-row block-row",
    headerClass: "diagram-node-box-header",
    titleWrapClass: "diagram-node-box-title-wrap",
    titleRowClass: "diagram-node-box-title-row",
    nameClass: "diagram-node-box-name",
    descClass: "diagram-node-box-desc",
    draggingClass: "diagram-node-box--dragging",
  };

  it.each(["pattern", "impact", "custom"] as const)("gives %s the shared diagram-node-box entry", (kind) => {
    expect(NODE_STYLES[kind]).toEqual(SHARED_BASE);
  });

  it("gives epic the shared entry minus a description row", () => {
    expect(NODE_STYLES.epic).toEqual({ ...SHARED_BASE, descClass: undefined });
  });

  it("keeps c1 on its own Block-mirroring classes", () => {
    expect(NODE_STYLES.c1).toEqual({
      boxClass: "block block-c1-system",
      rowClass: "block-row",
      headerClass: "block-header",
      titleWrapClass: "block-title",
      titleRowClass: "block-name-row",
      nameClass: "block-name",
      descClass: "block-description",
      draggingClass: "c1-node-anchor--dragging",
    });
  });
});
