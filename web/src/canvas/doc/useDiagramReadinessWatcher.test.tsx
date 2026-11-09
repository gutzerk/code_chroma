import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { EngineClient } from "../../engine-client/EngineClient";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { EMPTY_CANVAS_DOC, type DiagramsStatus } from "../../state/types";
import { agentStore } from "../../agents/agentStore";
import { canvasDocStore } from "./canvasDocStore";
import { diagramWatcherErrorStore } from "./diagramWatcherErrorStore";
import { readCachedDiagramsStatus, writeCachedDiagramsStatus } from "./diagramStatusCache";
import { dismissDiagram, resetDismissedDiagrams } from "./dismissedDiagrams";
import { useDiagramReadinessWatcher } from "./useDiagramReadinessWatcher";

function Harness() {
  useDiagramReadinessWatcher();
  return null;
}

const OK_RUN = { ok: true as const, batch_id: "b1", id_map: {}, affected: [] };

function renderWatcher(
  runRecipe: () => Promise<unknown>,
  status: DiagramsStatus | (() => Promise<DiagramsStatus>) = { c1: { ready: true, fingerprint: "a" } },
) {
  const client = {
    getDiagramsStatus: typeof status === "function" ? status : async () => status,
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
  canvasDocStore.setDoc(EMPTY_CANVAS_DOC);
  diagramWatcherErrorStore.reset();
  resetDismissedDiagrams();
  agentStore.setActiveWorkspace("main");
  sessionStorage.clear();
  writeCachedDiagramsStatus({ c1: { ready: false } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useDiagramReadinessWatcher", () => {
  it("surfaces a failed auto-draw so the next ping retries", async () => {
    const runRecipe = vi.fn(async () => ({ ok: false, errors: [{ message: "boom" }] }));

    renderWatcher(runRecipe);

    await waitFor(() => expect(diagramWatcherErrorStore.getError()).toBe("boom"));
    expect(readCachedDiagramsStatus()).toEqual({ c1: { ready: false } });
  });

  it("adds a ready diagram that is not on the canvas even when the baseline already said ready", async () => {
    writeCachedDiagramsStatus({ impact: { ready: true, fingerprint: "fp" } });
    const runRecipe = vi.fn(async () => OK_RUN);

    renderWatcher(runRecipe, { impact: { ready: true, fingerprint: "fp" } });

    await waitFor(() => expect(runRecipe).toHaveBeenCalledWith("impact"));
  });

  it("adds nothing until the canvas doc has loaded", async () => {
    canvasDocStore.reset();
    const runRecipe = vi.fn(async () => OK_RUN);
    renderWatcher(runRecipe, { impact: { ready: true, fingerprint: "fp" } });
    await act(async () => {});
    expect(runRecipe).not.toHaveBeenCalled();

    act(() => canvasDocStore.setDoc(EMPTY_CANVAS_DOC));

    await waitFor(() => expect(runRecipe).toHaveBeenCalledWith("impact"));
  });

  it("leaves a layer taken off the canvas alone while its fingerprint is unchanged", async () => {
    dismissDiagram("main", "impact", "fp");
    const runRecipe = vi.fn(async () => OK_RUN);

    renderWatcher(runRecipe, { impact: { ready: true, fingerprint: "fp" } });
    await act(async () => {});

    expect(runRecipe).not.toHaveBeenCalled();
  });

  it("brings a dismissed layer back once its artifact is redrawn", async () => {
    dismissDiagram("main", "impact", "fp-old");
    const runRecipe = vi.fn(async () => OK_RUN);

    renderWatcher(runRecipe, { impact: { ready: true, fingerprint: "fp-new" } });

    await waitFor(() => expect(runRecipe).toHaveBeenCalledWith("impact"));
  });

  it("keeps each workspace's status baseline under its own cache key", async () => {
    agentStore.setActiveWorkspace("pr-275");

    renderWatcher(vi.fn(async () => OK_RUN), { impact: { ready: true, fingerprint: "fp" } });

    await waitFor(() => expect(readCachedDiagramsStatus("pr-275")).toEqual({ impact: { ready: true, fingerprint: "fp" } }));
    expect(readCachedDiagramsStatus()).toEqual({ c1: { ready: false } });
  });

  it("retries a failed status fetch when the user comes back to the window", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const getStatus = vi
      .fn<() => Promise<DiagramsStatus>>()
      .mockRejectedValueOnce(new Error("timed out"))
      .mockResolvedValue({ impact: { ready: true, fingerprint: "fp" } });
    const runRecipe = vi.fn(async () => OK_RUN);
    renderWatcher(runRecipe, getStatus);
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(runRecipe).toHaveBeenCalledWith("impact"));
  });
});
