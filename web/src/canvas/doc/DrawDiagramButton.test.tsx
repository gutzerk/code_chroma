import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentClient } from "../../agents/agentClient";
import { agentStore } from "../../agents/agentStore";
import { AgentClientProvider } from "../../agents/AgentClientContext";
import { PR_CLIENT_STUB } from "../../agents/stubAgentClient";
import type { EngineClient } from "../../engine-client/EngineClient";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { IMPACT_CHANGES_STUB } from "../../engine-client/stubEngineClient";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type DiagramsStatus } from "../../state/types";
import { canvasDocStore } from "./canvasDocStore";
import { writeCachedDiagramsStatus } from "./diagramStatusCache";
import { DrawDiagramButton } from "./DrawDiagramButton";
import { useDiagramReadinessWatcher } from "./useDiagramReadinessWatcher";

function ButtonWithWatcher() {
  useDiagramReadinessWatcher();
  return <DrawDiagramButton />;
}

function docWithC1(): CanvasDoc {
  return {
    ...EMPTY_CANVAS_DOC,
    elements: {
      c1: {
        id: "c1",
        render: "c1",
        layer: "c1",
        label: "System",
        description: "",
        node_id: null,
        position: { x: 0, y: 0 },
        size: null,
        group_id: null,
        meta: { recipe_key: "n1" },
        created_by: "ai",
      },
    },
  };
}

function renderButton(client: Partial<EngineClient>, agentClient: Partial<AgentClient> = {}) {
  return render(
    <EngineClientProvider repoId="main" client={{ ...IMPACT_CHANGES_STUB, ...client } as EngineClient}>
      <AgentClientProvider client={{ ...PR_CLIENT_STUB, ...agentClient } as unknown as AgentClient}>
        <ButtonWithWatcher />
      </AgentClientProvider>
    </EngineClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  canvasDocStore.reset();
  agentStore.reset();
  drawDialogStore.reset();
  sessionStorage.clear();
});

describe("DrawDiagramButton", () => {
  it("is always clickable, regardless of readiness -- no dropdown, no conditional hiding", () => {
    renderButton({ getDiagramsStatus: async () => ({ c1: { ready: true, fingerprint: "fp" } }) });

    expect(screen.getByTestId("draw-diagram-button")).toBeInTheDocument();
    expect(screen.getByTestId("draw-diagram-button")).not.toBeDisabled();
  });

  it("opens the Draw dialog on click instead of launching an agent", () => {
    const create = vi.fn();

    renderButton({}, { create });
    fireEvent.click(screen.getByTestId("draw-diagram-button"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("draw-diagram-button"));
    });
    expect(create).toHaveBeenCalled();
  });

  it("disables itself while an agent launch is in flight, so a click gets visible feedback", () => {
    renderButton({});

    act(() => agentStore.setIsLaunching(true));

    expect(screen.getByTestId("draw-diagram-button")).toBeDisabled();
  });
});

describe("DrawDiagramButton: a diagram edited before a page reload", () => {
  it("re-runs the recipe on mount once the cached fingerprint disagrees with the fresh one", async () => {
    // A previous visit (before the reload) already saw c1 at "fp-old" and cached that to
    // sessionStorage; the persisted canvas still holds that now-stale c1 diagram.
    writeCachedDiagramsStatus({ c1: { ready: true, fingerprint: "fp-old" } });
    canvasDocStore.setDoc(docWithC1());
    const runRecipe = vi.fn(async () => ({
      ok: true as const,
      batch_id: "b1",
      id_map: {},
      affected: [],
    }));

    // A fresh render is what a page reload produces: brand-new component instances, no in-memory
    // state carried over -- only sessionStorage and the persisted canvas doc survive.
    renderButton({
      getDiagramsStatus: async () => ({ c1: { ready: true, fingerprint: "fp-new" } }),
      runRecipe,
      getCanvas: async () => docWithC1(),
    });

    await waitFor(() => expect(runRecipe).toHaveBeenCalledWith("c1"));
  });

  it("does not re-run the recipe when the fingerprint is unchanged since the last visit", async () => {
    writeCachedDiagramsStatus({ c1: { ready: true, fingerprint: "fp-same" } });
    canvasDocStore.setDoc(docWithC1());
    const runRecipe = vi.fn();
    // A promise the test controls, so it can await the exact point refetchStatus's status fetch
    // resolves -- and, since DrawDiagramButton's own `await` on it was registered first, everything
    // that fetch's continuation does synchronously (including any runRecipe call) has already run
    // by then. A plain `waitFor` immediately checking "not called" would pass trivially before the
    // fetch even settles, proving nothing.
    let resolveStatus!: (status: DiagramsStatus) => void;
    const statusPromise = new Promise<DiagramsStatus>((resolve) => {
      resolveStatus = resolve;
    });

    renderButton({ getDiagramsStatus: () => statusPromise, runRecipe });
    await act(async () => {
      resolveStatus({ c1: { ready: true, fingerprint: "fp-same" } });
      await statusPromise;
    });

    expect(runRecipe).not.toHaveBeenCalled();
  });
});
