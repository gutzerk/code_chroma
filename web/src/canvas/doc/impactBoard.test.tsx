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
import { EMPTY_IMPACT_CHANGES, type ImpactBlockChange, type ImpactChanges } from "../../state/types";

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
