import { afterEach, describe, expect, it } from "vitest";
import type { EngineClient } from "../../engine-client/EngineClient";
import { EMPTY_CANVAS_DOC, type CanvasBatch } from "../../state/types";
import { canvasDocStore } from "../doc/canvasDocStore";
import { addSampleDiagram, SAMPLE_LAYER } from "./layoutPlaygroundSample";

function recordingClient(batches: CanvasBatch[]): EngineClient {
  return {
    patchCanvas: async (batch: CanvasBatch) => {
      batches.push(batch);
      return { ok: true, batch_id: "b", id_map: {}, affected: [] };
    },
    getCanvas: async () => EMPTY_CANVAS_DOC,
  } as unknown as EngineClient;
}

afterEach(() => canvasDocStore.reset());

describe("addSampleDiagram", () => {
  it("writes the sample on its own layer without positions, so the first-draw layout places it", async () => {
    const batches: CanvasBatch[] = [];

    await addSampleDiagram(recordingClient(batches));

    expect(batches[0].layer).toBe(SAMPLE_LAYER);
    expect(batches[0].ops.some((op) => op.position)).toBe(false);
  });
});
