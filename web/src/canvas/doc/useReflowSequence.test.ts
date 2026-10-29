import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type CanvasElement, type CanvasOp } from "../../state/types";
import type { EngineClient } from "../../engine-client/EngineClient";
import { useReflowSequence } from "./useReflowSequence";
import { messageEl, participantEl } from "./sequenceTestElements";

const patchMock = vi.fn(async (_ops: CanvasOp[]) => ({ ok: true as const }));
vi.mock("./canvasDocStore", () => ({
  patchCanvasDoc: (_client: EngineClient, ops: CanvasOp[]) => patchMock(ops),
}));

const docOf = (elements: CanvasElement[]): CanvasDoc => ({
  ...EMPTY_CANVAS_DOC,
  elements: Object.fromEntries(elements.map((e) => [e.id, e])),
});

const staleSequence = () => docOf([participantEl("a"), participantEl("b"), messageEl("m1", "a", "b", "1")]);

describe("useReflowSequence", () => {
  beforeEach(() => patchMock.mockClear());

  it("re-spreads stale sequence geometry once the doc loads after mount", async () => {
    const { rerender } = renderHook(({ doc, loaded }) => useReflowSequence({} as EngineClient, doc, loaded), {
      initialProps: { doc: EMPTY_CANVAS_DOC, loaded: false },
    });

    rerender({ doc: staleSequence(), loaded: true });
    await Promise.resolve();

    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock.mock.calls[0][0].length).toBeGreaterThan(0);
  });

  it("does nothing before the doc has loaded", async () => {
    renderHook(() => useReflowSequence({} as EngineClient, staleSequence(), false));

    await Promise.resolve();

    expect(patchMock).not.toHaveBeenCalled();
  });
});
