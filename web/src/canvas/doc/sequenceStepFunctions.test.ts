import { describe, expect, it } from "vitest";
import { pickStepFunctions, rankFunctions, STEP_FUNCTION_SLOTS, wordsOf } from "./sequenceStepFunctions";

const fns = (...names: string[]) => names.map((name) => ({ nodeId: `f::${name}`, name }));

describe("sequenceStepFunctions", () => {
  it("splits camelCase and snake_case names into words", () => {
    expect(wordsOf("DiffManifest load_manifest")).toEqual(["diff", "manifest", "load", "manifest"]);
  });

  it("ranks functions sharing the step's words first and keeps source order on ties", () => {
    const ranked = rankFunctions(fns("Start", "Helper", "DiffManifest", "LoadManifest"), "Diff vs manifest");

    expect(ranked.map((f) => f.name)).toEqual(["DiffManifest", "LoadManifest", "Start", "Helper"]);
  });

  it("leaves one slot for the '+ more' card when the code has more functions than slots", () => {
    const many = fns(...Array.from({ length: STEP_FUNCTION_SLOTS + 2 }, (_, i) => `f${i}`));

    expect(pickStepFunctions(many, "x")).toHaveLength(STEP_FUNCTION_SLOTS - 1);
    expect(pickStepFunctions(many.slice(0, STEP_FUNCTION_SLOTS), "x")).toHaveLength(STEP_FUNCTION_SLOTS);
  });
});
