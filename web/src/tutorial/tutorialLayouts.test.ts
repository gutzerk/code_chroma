import { afterEach, describe, expect, it } from "vitest";
import { reset, seedLayerPositions, takeCachedPosition } from "../canvas/doc/layerPositionCache";
import { TUTORIAL_LAYOUTS } from "./tutorialLayouts";

afterEach(() => reset());

describe("tutorial layouts", () => {
  it("covers every box of the patterns diagram", () => {
    expect(Object.keys(TUTORIAL_LAYOUTS.patterns)).toHaveLength(11);
  });

  it("seeds positions that the layout pass can take once", () => {
    seedLayerPositions("patterns", TUTORIAL_LAYOUTS.patterns);

    const first = takeCachedPosition("patterns", "infra::frontend");
    const second = takeCachedPosition("patterns", "infra::frontend");

    expect(first).toEqual(TUTORIAL_LAYOUTS.patterns["infra::frontend"]);
    expect(second).toBeUndefined();
  });
});
