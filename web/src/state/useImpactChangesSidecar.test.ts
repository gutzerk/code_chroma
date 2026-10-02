import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { impactChangesSidecarStore, useImpactChangesSidecar } from "./useSidecar";
import { expansionStore } from "./expansionState";
import type { EngineClient } from "../engine-client/EngineClient";
import type {
  ImpactBlockChange,
  ImpactChanges,
  DiagramGenerationStatus,
  ImpactGhostBlock,
  HierarchyNodeRef,
} from "./types";

const ROOT: HierarchyNodeRef = {
  node_id: "root",
  name: "examples",
  level: "folder",
  parent_id: null,
  has_children: true,
  child_count: 1,
};
const FILE: HierarchyNodeRef = {
  node_id: "file::a.py",
  name: "a.py",
  level: "file",
  parent_id: "root",
  has_children: true,
  child_count: 1,
};
const FUNCTION: HierarchyNodeRef = {
  node_id: "function::foo",
  name: "foo",
  level: "function",
  parent_id: "file::a.py",
  has_children: false,
  child_count: 0,
};
const NODES_BY_ID: Record<string, HierarchyNodeRef> = {
  root: ROOT,
  "file::a.py": FILE,
  "function::foo": FUNCTION,
};

function block(overrides: Partial<ImpactBlockChange> = {}): ImpactBlockChange {
  return {
    block: "function::foo",
    node_id: "function::foo",
    name: "foo",
    path: "a.py",
    status: "modified",
    files: [],
    change_count: 1,
    before: "",
    after: "",
    explanation: "",
    pr_comments: [],
    ...overrides,
  };
}

function ghost(overrides: Partial<ImpactGhostBlock> = {}): ImpactGhostBlock {
  return {
    id: "clustering",
    node_id: "impact-ghost::file::a.py/clustering",
    parent: "file::a.py",
    parent_node_id: "file::a.py",
    name: "Reference clustering",
    status: "removed",
    before: "",
    after: "",
    explanation: "",
    ...overrides,
  };
}

function changes(overrides: Partial<ImpactChanges> = {}): ImpactChanges {
  return {
    fingerprint: "current",
    reviewed_fingerprint: null,
    has_review: false,
    stale: false,
    summary: "",
    blocks: [],
    ghosts: [],
    relationships: [],
    unassigned: [],
    changed_file_count: 2,
    general_pr_comments: [],
    ...overrides,
  };
}

const REVIEWED = changes({
  has_review: true,
  reviewed_fingerprint: "current",
  summary: "Reworked the engine.",
});

const STALE = changes({ has_review: true, stale: true, reviewed_fingerprint: "older" });

/** A stub exposing only what the hook touches, plus hooks to fire each live ping it listens on. */
function clientFor(sequence: ImpactChanges[]) {
  let call = 0;
  let pingChanges: (() => void) | null = null;
  let pingChanged: (() => void) | null = null;
  let pingStatus: ((next: DiagramGenerationStatus) => void) | null = null;
  const generateDiagram = vi.fn(async () => ({ state: "generating" as const, error: null }));
  const client = {
    getSidecar: vi.fn(async () => sequence[Math.min(call++, sequence.length - 1)]),
    getNode: vi.fn(async (nodeId: string) => NODES_BY_ID[nodeId] ?? null),
    generateDiagram,
    getDiagramStatus: vi.fn(async () => ({ state: "idle" as const, error: null })),
    subscribeSidecar: (_kind: string, listener: () => void) => {
      pingChanges = listener;
      return () => {
        pingChanges = null;
      };
    },
    subscribeDiagramStatus: (_kind: string, listener: (next: DiagramGenerationStatus) => void) => {
      pingStatus = listener;
      return () => {
        pingStatus = null;
      };
    },
    subscribe: (listener: () => void) => {
      pingChanged = listener;
      return () => {
        pingChanged = null;
      };
    },
  } as unknown as EngineClient;
  return {
    client,
    generateDiagram,
    pingChanges: () => pingChanges?.(),
    pingChanged: () => pingChanged?.(),
    pingStatus: (next: DiagramGenerationStatus) => pingStatus?.(next),
  };
}

afterEach(() => {
  impactChangesSidecarStore.reset();
  expansionStore.reset();
});

describe("useImpactChangesSidecar", () => {
  it("publishes the fetched review to the store once enabled", async () => {
    const { client } = clientFor([REVIEWED]);

    renderHook(() => useImpactChangesSidecar(client, true));

    await waitFor(() =>
      expect(impactChangesSidecarStore.getSnapshot().summary).toBe("Reworked the engine."),
    );
  });

  it("reports loading until the first fetch resolves, then clears it", async () => {
    let resolveFetch: ((value: ImpactChanges) => void) | null = null;
    const client = {
      getSidecar: vi.fn(
        () =>
          new Promise<ImpactChanges>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
      getNode: vi.fn(async (nodeId: string) => NODES_BY_ID[nodeId] ?? null),
      generateDiagram: vi.fn(),
      getDiagramStatus: vi.fn(async () => ({ state: "idle" as const, error: null })),
      subscribeSidecar: () => () => {},
      subscribeDiagramStatus: () => () => {},
      subscribe: () => () => {},
    } as unknown as EngineClient;

    const { result } = renderHook(() => useImpactChangesSidecar(client, true));
    expect(result.current.loading).toBe(true);

    resolveFetch!(REVIEWED);

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("fetches nothing and stays inactive while disabled", async () => {
    const { client } = clientFor([REVIEWED]);

    renderHook(() => useImpactChangesSidecar(client, false));

    await waitFor(() => expect(impactChangesSidecarStore.getIsActive()).toBe(false));
    expect(client.getSidecar).not.toHaveBeenCalled();
  });

  it("never auto-starts a review run when no review exists yet — only rereview() may", async () => {
    const { client, generateDiagram } = clientFor([changes()]);

    renderHook(() => useImpactChangesSidecar(client, true));

    await waitFor(() => expect(client.getSidecar).toHaveBeenCalled());
    expect(generateDiagram).not.toHaveBeenCalled();
  });

  it("never auto-starts a review run when the existing one reviewed a different diff", async () => {
    const { client, generateDiagram } = clientFor([STALE]);

    renderHook(() => useImpactChangesSidecar(client, true));

    await waitFor(() => expect(client.getSidecar).toHaveBeenCalled());
    expect(generateDiagram).not.toHaveBeenCalled();
  });

  it("starts a review run when the user presses Re-review, and only then", async () => {
    const { client, generateDiagram } = clientFor([changes()]);
    const { result } = renderHook(() => useImpactChangesSidecar(client, true));
    await waitFor(() => expect(client.getSidecar).toHaveBeenCalled());
    expect(generateDiagram).not.toHaveBeenCalled();

    result.current.rereview();

    await waitFor(() => expect(generateDiagram).toHaveBeenCalledTimes(1));
  });

  it("shows the stale review immediately rather than blanking", async () => {
    const { client } = clientFor([STALE]);

    renderHook(() => useImpactChangesSidecar(client, true));

    await waitFor(() => expect(impactChangesSidecarStore.getSnapshot().stale).toBe(true));
  });

  it("never starts a run on a live diff-change ping either, even with no review yet", async () => {
    const { client, generateDiagram, pingChanged } = clientFor([changes(), changes()]);
    renderHook(() => useImpactChangesSidecar(client, true));
    await waitFor(() => expect(client.getSidecar).toHaveBeenCalledTimes(1));

    pingChanged();

    await waitFor(() => expect(client.getSidecar).toHaveBeenCalledTimes(2));
    expect(generateDiagram).not.toHaveBeenCalled();
  });

  it("reuses a current review without spawning a run", async () => {
    const { client, generateDiagram } = clientFor([REVIEWED]);

    renderHook(() => useImpactChangesSidecar(client, true));

    await waitFor(() => expect(client.getSidecar).toHaveBeenCalled());
    expect(generateDiagram).not.toHaveBeenCalled();
  });

  it("keeps the deterministic badges but starts no run when generation is not allowed", async () => {
    const { client, generateDiagram } = clientFor([changes()]);

    renderHook(() => useImpactChangesSidecar(client, true, false));

    await waitFor(() => expect(impactChangesSidecarStore.getIsActive()).toBe(true));
    expect(generateDiagram).not.toHaveBeenCalled();
  });

  it("starts no run for a stale review either when generation is not allowed", async () => {
    const { client, generateDiagram } = clientFor([STALE]);

    renderHook(() => useImpactChangesSidecar(client, true, false));

    await waitFor(() => expect(impactChangesSidecarStore.getSnapshot().stale).toBe(true));
    expect(generateDiagram).not.toHaveBeenCalled();
  });

  it("Re-review is inert when generation is not allowed", async () => {
    const { client, generateDiagram } = clientFor([changes()]);
    const { result } = renderHook(() => useImpactChangesSidecar(client, true, false));
    await waitFor(() => expect(impactChangesSidecarStore.getIsActive()).toBe(true));

    result.current.rereview();

    expect(generateDiagram).not.toHaveBeenCalled();
  });

  it("ignores a second Re-review click while the first run is still writing", async () => {
    const { client, generateDiagram } = clientFor([changes(), changes()]);
    const { result } = renderHook(() => useImpactChangesSidecar(client, true));
    await waitFor(() => expect(client.getSidecar).toHaveBeenCalled());

    result.current.rereview();
    result.current.rereview();

    await waitFor(() => expect(generateDiagram).toHaveBeenCalledTimes(1));
  });

  it("lets Re-review retry after a run that errored without ever writing a review file", async () => {
    // A first-ever review that fails writes nothing (SkillAgent._restore has no snapshot to put
    // back), so the file ping that normally clears the guard never fires — only the status ping does.
    const { client, generateDiagram, pingStatus } = clientFor([changes()]);
    const { result } = renderHook(() => useImpactChangesSidecar(client, true));
    await waitFor(() => expect(client.getSidecar).toHaveBeenCalled());
    result.current.rereview();
    await waitFor(() => expect(generateDiagram).toHaveBeenCalledTimes(1));

    pingStatus({ state: "error", error: "claude exited 1" });
    result.current.rereview();

    await waitFor(() => expect(generateDiagram).toHaveBeenCalledTimes(2));
  });

  it("re-fetches when the review file is rewritten, so prose appears as it is written", async () => {
    const { client, pingChanges } = clientFor([changes(), REVIEWED]);
    renderHook(() => useImpactChangesSidecar(client, true));
    await waitFor(() => expect(client.getSidecar).toHaveBeenCalledTimes(1));

    pingChanges();

    await waitFor(() =>
      expect(impactChangesSidecarStore.getSnapshot().summary).toBe("Reworked the engine."),
    );
  });

  it("clears the store when the review mode is left", async () => {
    const { client } = clientFor([REVIEWED]);
    const { unmount } = renderHook(() => useImpactChangesSidecar(client, true));
    await waitFor(() => expect(impactChangesSidecarStore.getIsActive()).toBe(true));

    unmount();

    expect(impactChangesSidecarStore.getIsActive()).toBe(false);
  });

  it("keeps the store identity stable across an unchanged re-fetch", async () => {
    const { client, pingChanged } = clientFor([REVIEWED, REVIEWED]);
    renderHook(() => useImpactChangesSidecar(client, true));
    await waitFor(() => expect(impactChangesSidecarStore.getIsActive()).toBe(true));
    const first = impactChangesSidecarStore.getSnapshot();

    pingChanged();

    await waitFor(() => expect(client.getSidecar).toHaveBeenCalledTimes(2));
    expect(impactChangesSidecarStore.getSnapshot()).toBe(first);
  });

  it("auto-reveals a changed box's real ancestors so its badge has somewhere to mount", async () => {
    const { client } = clientFor([changes({ blocks: [block()] })]);

    renderHook(() => useImpactChangesSidecar(client, true));

    await waitFor(() => expect(impactChangesSidecarStore.getIsActive()).toBe(true));
    await waitFor(() => expect(expansionStore.isVisible("root")).toBe(true));
    expect(expansionStore.isVisible("file::a.py")).toBe(true);
  });

  it("surfaces a rejected rereview and resets the guard so a later Re-review click can retry", async () => {
    const { client, generateDiagram, pingChanged } = clientFor([REVIEWED, changes()]);
    generateDiagram.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useImpactChangesSidecar(client, true));
    await waitFor(() => expect(client.getSidecar).toHaveBeenCalled());

    result.current.rereview();

    await waitFor(() => expect(result.current.error).toBe("network down"));
    expect(result.current.state).toBe("error");

    // A live ping alone must never retry the agent on the user's behalf — only an explicit
    // Re-review click may. Had the failed rereview left triggeredRef stuck at true, the assertion
    // below would still pass for the wrong reason, so this only proves the guard resets; the next
    // assertion proves the ping itself started nothing.
    pingChanged();
    await waitFor(() => expect(client.getSidecar).toHaveBeenCalledTimes(2));
    expect(generateDiagram).toHaveBeenCalledTimes(1);

    result.current.rereview();

    await waitFor(() => expect(generateDiagram).toHaveBeenCalledTimes(2));
  });

  it("auto-reveals a ghost's parent box itself, not just the parent's ancestors", async () => {
    const { client } = clientFor([changes({ ghosts: [ghost()] })]);

    renderHook(() => useImpactChangesSidecar(client, true));

    await waitFor(() => expect(impactChangesSidecarStore.getIsActive()).toBe(true));
    // The ghost's parent (file::a.py) is itself expanded (it's the ghost's container), and its own
    // ancestor (root) is expanded too via the plain revealNode ancestor walk.
    await waitFor(() => expect(expansionStore.getBlockView("file::a.py").expand_state).toBe("expanded"));
    expect(expansionStore.isVisible("root")).toBe(true);
  });
});
