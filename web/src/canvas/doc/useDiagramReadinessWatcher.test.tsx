import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { EngineClient } from "../../engine-client/EngineClient";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { canvasDocStore } from "./canvasDocStore";
import { diagramWatcherErrorStore } from "./diagramWatcherErrorStore";
import { readCachedDiagramsStatus, writeCachedDiagramsStatus } from "./diagramStatusCache";
import { useDiagramReadinessWatcher } from "./useDiagramReadinessWatcher";

function Harness() {
  useDiagramReadinessWatcher();
  return null;
}

function renderWatcher(runRecipe: () => Promise<unknown>) {
  const client = {
    getDiagramsStatus: async () => ({ c1: { ready: true, fingerprint: "a" } }),
    subscribeDiagram: () => () => {},
    runRecipe,
    getCanvas: async () => canvasDocStore.getDoc(),
  } as unknown as EngineClient;
  return render(
    <EngineClientProvider repoId="main" client={client}>
      <Harness />
    </EngineClientProvider>,
  );
}

beforeEach(() => {
  canvasDocStore.reset();
  diagramWatcherErrorStore.reset();
  sessionStorage.clear();
  writeCachedDiagramsStatus({ c1: { ready: false } });
});

afterEach(cleanup);

describe("useDiagramReadinessWatcher", () => {
  it("surfaces a failed auto-draw and keeps the old baseline so it can retry", async () => {
    const runRecipe = vi.fn(async () => ({ ok: false, errors: [{ message: "boom" }] }));

    renderWatcher(runRecipe);

    await waitFor(() => expect(diagramWatcherErrorStore.getError()).toBe("boom"));
    expect(readCachedDiagramsStatus()).toEqual({ c1: { ready: false } });
  });
});
