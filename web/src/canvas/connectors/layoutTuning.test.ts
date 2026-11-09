import { afterEach, describe, expect, it } from "vitest";
import { computeElkLayout } from "./elkLayout";
import { DEFAULT_LAYOUT_TUNING, changedTuning, layoutTuning, layoutTuningStore, parseElkOptions } from "./layoutTuning";

const NODES = [
  { id: "a", width: 100, height: 50 },
  { id: "b", width: 100, height: 50 },
];
const EDGES = [{ from: "a", to: "b" }];

async function verticalGap(): Promise<number> {
  const { boxes } = await computeElkLayout(NODES, EDGES);
  const [a, b] = boxes;
  return b.y - a.y;
}

afterEach(() => {
  layoutTuningStore.resetTuning();
  layoutTuningStore.setEnabled(false);
});

describe("layoutTuning", () => {
  it("returns the defaults while the playground is off", () => {
    layoutTuningStore.update({ rankSep: 999 });

    expect(layoutTuning().rankSep).toBe(DEFAULT_LAYOUT_TUNING.rankSep);
  });

  it("returns the overrides while the playground is on", () => {
    layoutTuningStore.update({ rankSep: 999 });
    layoutTuningStore.setEnabled(true);

    expect(layoutTuning().rankSep).toBe(999);
  });

  it("feeds the layer gap into the ELK pass", async () => {
    const before = await verticalGap();
    layoutTuningStore.setEnabled(true);
    layoutTuningStore.update({ rankSep: DEFAULT_LAYOUT_TUNING.rankSep + 200 });

    const after = await verticalGap();

    expect(after - before).toBe(200);
  });

  it("lists only the values that differ from the defaults", () => {
    layoutTuningStore.update({ nodeSep: 1 });

    expect(changedTuning(layoutTuningStore.getTuning())).toEqual({ nodeSep: 1 });
  });
});

describe("parseElkOptions", () => {
  it("reads key=value lines and skips blanks and comments", () => {
    const text = "# note\nelk.edgeRouting = SPLINES\n\nbad line\nelk.x=1";

    expect(parseElkOptions(text)).toEqual({ "elk.edgeRouting": "SPLINES", "elk.x": "1" });
  });
});
