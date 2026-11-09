import { afterEach, describe, expect, it, vi } from "vitest";
import { drawDialogStore } from "../canvas/doc/drawDialog/drawDialogStore";
import type { EngineClient } from "../engine-client/EngineClient";
import { applyStageState } from "./tutorialStageState";

vi.mock("../canvas/doc/diagramCatalog", () => ({
  removeLayerAndRefresh: vi.fn(async () => undefined),
  runRecipeAndLayout: vi.fn(async () => undefined),
}));

afterEach(() => {
  drawDialogStore.reset();
});

describe("applyStageState", () => {
  it("closes a Draw dialog left open when the user jumps to another stage", async () => {
    drawDialogStore.open();

    await applyStageState(2, {} as EngineClient);

    expect(drawDialogStore.getState().open).toBe(false);
  });
});
