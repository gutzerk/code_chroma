import { describe, expect, it } from "vitest";
import { estimateTimeRemaining, parseWikiGeneralProgress } from "./wikiGeneralProgress";

describe("parseWikiGeneralProgress", () => {
  it("returns null before any progress line has arrived", () => {
    expect(parseWikiGeneralProgress(["⏺ resolve-undetermined (31 files)"])).toBeNull();
  });

  it("returns null for an empty feed", () => {
    expect(parseWikiGeneralProgress([])).toBeNull();
  });

  it("reads the completed/total pair off a progress line", () => {
    expect(parseWikiGeneralProgress(["→ 12/39 c3:auth"])).toEqual({
      completed: 12,
      total: 39,
      percent: (12 / 39) * 100,
    });
  });

  it("uses the most recent progress line when several are present", () => {
    const lines = ["⏺ write-c3 (39 components)", "→ 1/39 c3:a", "→ 2/39 c3:b"];
    expect(parseWikiGeneralProgress(lines)).toEqual({
      completed: 2,
      total: 39,
      percent: (2 / 39) * 100,
    });
  });

  it("caps percent at 100 even if completed somehow exceeds total", () => {
    expect(parseWikiGeneralProgress(["→ 40/39 c3:z"])?.percent).toBe(100);
  });
});

describe("estimateTimeRemaining", () => {
  it("returns null before any job has completed", () => {
    expect(estimateTimeRemaining({ completed: 0, total: 8, percent: 0 }, 5000)).toBeNull();
  });

  it("returns null once nothing remains", () => {
    expect(estimateTimeRemaining({ completed: 8, total: 8, percent: 100 }, 5000)).toBeNull();
  });

  it("returns null for a null progress", () => {
    expect(estimateTimeRemaining(null, 5000)).toBeNull();
  });

  it("extrapolates minutes remaining from the average time per completed job", () => {
    // 2 jobs in 20s -> 10s/job, 6 jobs left -> 60s.
    expect(estimateTimeRemaining({ completed: 2, total: 8, percent: 25 }, 20_000)).toBe("~1m left");
  });

  it("extrapolates seconds remaining when the total is under a minute", () => {
    // 1 job in 3s -> 3s/job, 1 job left -> 3s.
    expect(estimateTimeRemaining({ completed: 1, total: 2, percent: 50 }, 3_000)).toBe("~3s left");
  });
});
