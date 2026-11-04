import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImpactGlance } from "./ImpactGlance";
import {
  barWidths,
  boxKindOf,
  changeSizeOf,
  collapseKindOf,
  firstSentence,
  isTestPath,
  summarizeImpact,
} from "./impactGlanceLogic";
import { EMPTY_CANVAS_DOC, EMPTY_IMPACT_CHANGES, type CanvasDoc, type CanvasElement, type ImpactBlockChange, type ImpactChanges } from "../../state/types";
import { mergedPillsOf } from "./impactBoxState";
import { isRemovedLink } from "./impactEdgeStatus";
import { IMPACT_CARD, impactBoardNeedsReflow, impactFoldersOf, impactPathOf, layoutImpactBoard } from "./impactBoardLayout";

const block = (id: string, status: ImpactBlockChange["status"], files: ImpactBlockChange["files"]): ImpactBlockChange => ({
  block: id, node_id: `n-${id}`, name: id, path: null, status, files,
  change_count: files.length, before: "", after: "", explanation: "", pr_comments: [],
});
const file = (path: string, additions?: number, deletions?: number) => ({ path, status: "modified" as const, additions, deletions });
const changesOf = (blocks: ImpactBlockChange[]): ImpactChanges => ({ ...EMPTY_IMPACT_CHANGES, blocks, changed_file_count: blocks.length });

describe("impact board logic", () => {
  it("splits source and test lines and counts a repeated file once", () => {
    const change = block("a", "modified", [file("src/a.ts", 9, 71), file("src/a.ts", 9, 71), file("src/a.test.ts", 0, 37)]);

    const size = changeSizeOf(change);

    expect(size).toMatchObject({ add: 9, del: 71, testAdd: 0, testDel: 37, known: true, testKnown: true });
  });

  it("reports unknown size when git gave no counts", () => {
    expect(changeSizeOf(block("a", "modified", [file("src/a.ts")])).known).toBe(false);
  });

  it("recognises test paths", () => {
    expect([isTestPath("web/src/a.test.tsx"), isTestPath("tests/unit/x.py"), isTestPath("src/a.ts")]).toEqual([true, true, false]);
  });

  it("splits the 60px bar by additions and deletions", () => {
    expect(barWidths(20, 40)).toEqual({ add: 20, del: 40 });
    expect(barWidths(0, 0)).toEqual({ add: 0, del: 0 });
  });

  it("counts statuses and tests and picks the biggest non-deleted change", () => {
    const changes = changesOf([
      block("a", "modified", [file("a.ts", 2, 4)]),
      block("b", "modified", [file("b.ts", 9, 71), file("b.test.ts", 0, 37)]),
      block("c", "added", [file("c.ts", 5, 0)]),
      block("d", "removed", [file("d.ts", 0, 233)]),
    ]);

    const summary = summarizeImpact(changes);

    expect(summary).toMatchObject({ modified: 2, added: 1, deleted: 1, tests: 1, biggest: "b" });
  });

  it("folds only small modified boxes, and only when many boxes changed", () => {
    const small = Array.from({ length: 7 }, (_, i) => block(`s${i}`, "modified", [file(`s${i}.ts`, 1, 1)]));
    const wide = summarizeImpact(changesOf(small));
    const narrow = summarizeImpact(changesOf(small.slice(0, 3)));

    expect(wide.minor.size).toBe(7);
    expect(narrow.minor.size).toBe(0);
  });

  it("collapses unchanged context boxes but never a hero endpoint", () => {
    const summary = summarizeImpact(changesOf([block("a", "modified", [file("a.ts", 1, 1)])]));
    const base = { authored: "context", change: undefined, summary, hasChanges: true };

    expect(collapseKindOf({ ...base, isHeroEnd: false })).toBe("unchanged");
    expect(collapseKindOf({ ...base, isHeroEnd: true })).toBeNull();
    expect(collapseKindOf({ ...base, hasChanges: false, isHeroEnd: false })).toBeNull();
  });

  it("maps authored and git status to the board chip", () => {
    expect(boxKindOf("deleted", undefined)).toBe("delete");
    expect(boxKindOf(undefined, block("a", "added", []))).toBe("add");
    expect(boxKindOf("context", undefined)).toBeNull();
  });

  it("titles a summary by its first sentence", () => {
    expect(firstSentence("Draw skips the popover. More detail follows.")).toBe("Draw skips the popover.");
  });
});

describe("ImpactGlance size row", () => {
  it("shows the bar, the figures and the test lines", () => {
    const change = block("a", "modified", [file("a.ts", 9, 71), file("a.test.ts", 0, 37)]);

    render(<ImpactGlance change={change} elementId="a" />);

    expect(screen.getByTestId("impact-size")).toHaveTextContent("+9−71· test +0 −37");
  });
});

const el = (id: string, y: number, group: string | null = "g"): CanvasElement => ({
  id, render: "impact", layer: "impact", label: id.toUpperCase(), description: "", node_id: null,
  position: { x: 0, y }, size: null, group_id: group, meta: { recipe_key: id, status: "modified" }, created_by: "ai",
});
const docOf = (elements: CanvasElement[], edges: CanvasDoc["edges"] = {}): CanvasDoc => ({
  ...EMPTY_CANVAS_DOC, elements: Object.fromEntries(elements.map((e) => [e.id, e])), edges,
});

describe("impact board merging and removed links", () => {
  it("merges the minor boxes of one group into one pill led by the topmost", () => {
    const small = Array.from({ length: 7 }, (_, i) => block(`s${i}`, "modified", [file(`s${i}.ts`, 1, 1)]));
    const doc = docOf([el("s2", 200), el("s1", 100), el("s3", 300, "other")]);

    const merged = mergedPillsOf(doc, changesOf(small));

    expect(merged.get("s2")?.leader).toBe("s1");
    expect(merged.get("s1")?.names).toEqual(["S1", "S2"]);
    expect(merged.has("s3")).toBe(false);
  });

  it("treats an authored kind removed edge as a removed link", () => {
    const doc = docOf([el("a", 0), el("b", 100)], { e: { id: "e", from: "a", to: "b", label: "", kind: "removed", layer: "impact" } });

    expect(isRemovedLink(EMPTY_IMPACT_CHANGES, doc, "a", "b")).toBe(true);
    expect(isRemovedLink(EMPTY_IMPACT_CHANGES, doc, "b", "a")).toBe(false);
  });
});

const fileBox = (id: string, nodeId: string, x = 0, y = 0): CanvasElement => ({
  ...el(id, y, null), node_id: nodeId, position: { x, y }, meta: { recipe_key: id, status: "new" },
});

describe("impact board folders and layout", () => {
  it("buckets boxes by top-level area and folds lone boxes of one area together", () => {
    const boxes = [
      fileBox("a", "component::src/dags/x/a.py"),
      fileBox("b", "component::src/dags/api/b.yaml"),
      fileBox("c", "component::src/registry/c.yaml"),
      fileBox("d", "component::src/contracts/d.py"),
      fileBox("e", "dir::tests/dags"),
      fileBox("f", "component::docs/f.md"),
    ];

    const folders = impactFoldersOf(boxes).map((folder) => [folder.label, folder.ids.sort()]);

    expect(folders).toEqual(
      expect.arrayContaining([["src/dags", ["a", "b"]], ["src", ["c", "d"]], ["tests/dags", ["e"]], ["docs", ["f"]]]),
    );
  });

  it("lays every Impact box out as a 260x96 card and keeps a placed board's corner", () => {
    const card = { w: IMPACT_CARD.w, h: IMPACT_CARD.h };
    const doc = docOf([{ ...fileBox("a", "component::src/a.py", 500, 300), size: card }, { ...fileBox("b", "component::src/b.py", 900, 700), size: card }], {
      e: { id: "e", from: "a", to: "b", label: "", kind: "uses", layer: "impact" },
    });

    const { positions, sizes } = layoutImpactBoard(doc, ["a", "b"]);

    expect(sizes.a).toEqual({ w: IMPACT_CARD.w, h: IMPACT_CARD.h });
    expect(positions.a).toEqual({ x: 500, y: 300 });
    expect(positions.b.y).toBeGreaterThan(positions.a.y + IMPACT_CARD.h);
  });

  it("re-spreads only a board whose boxes are not card-sized yet", () => {
    const fresh = docOf([fileBox("a", "component::src/a.py")]);
    const laid = docOf([{ ...fileBox("a", "component::src/a.py"), size: { w: IMPACT_CARD.w, h: IMPACT_CARD.h } }]);

    expect(impactBoardNeedsReflow(fresh, ["a"])).toBe(true);
    expect(impactBoardNeedsReflow(laid, ["a"])).toBe(false);
  });

  it("reads a box path from meta.path first, then from its node id", () => {
    const authored = { ...fileBox("a", "component::src/a.py"), meta: { path: "./web/src/b.ts" } };

    expect(impactPathOf(authored)).toEqual({ path: "web/src/b.ts", isDir: false });
    expect(impactPathOf(fileBox("b", "src/x.py::function::run"))).toEqual({ path: "src/x.py", isDir: false });
    expect(impactPathOf(fileBox("c", "dir::tests/dags"))).toEqual({ path: "tests/dags", isDir: true });
  });
});
