import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshDiffs, resetRefreshDiffs, scheduleRefreshDiffs } from "./refreshDiffs";
import { changeCardStore } from "./changeCardStore";
import { diffOverlayStore } from "./diffOverlayStore";
import { expansionStore } from "./expansionState";
import { hierarchyChangesStore } from "./hierarchyChangesStore";
import type { EngineClient } from "../engine-client/EngineClient";
import type { ChangeCard, ChangeCardSet, FunctionDiff, HierarchyNodeRef } from "./types";
import { EPICS_STUB, EPIC_BRIEF_STUB, IMPACT_CHANGES_STUB, EMPTY_CHANGE_CARDS, PATTERNS_STUB } from "../engine-client/stubEngineClient";

afterEach(() => {
  diffOverlayStore.reset();
  changeCardStore.reset();
  hierarchyChangesStore.reset();
  expansionStore.reset();
  resetRefreshDiffs();
});

const FILE_NODE: HierarchyNodeRef = {
  node_id: "file::a.py",
  name: "a.py",
  level: "file",
  parent_id: null,
  has_children: true,
  child_count: 1,
};

const FUNCTION_NODE: HierarchyNodeRef = {
  node_id: "function::foo",
  name: "foo",
  level: "function",
  parent_id: "file::a.py",
  has_children: false,
  child_count: 0,
};

function card(overrides: Partial<ChangeCard> = {}): ChangeCard {
  return {
    id: "a.py::function::gone",
    text: "Deleted gone",
    details: "",
    node_id: "file::a.py",
    kind: "delete",
    resolution: "parent",
    file: "a.py",
    symbol: "gone",
    name: "gone",
    target: "function",
    status: "deleted",
    added_lines: 0,
    removed_lines: 4,
    binary: false,
    ...overrides,
  };
}

function cardSet(cards: ChangeCard[], byNodeStatus: Record<string, string> = {}): ChangeCardSet {
  return { ...EMPTY_CHANGE_CARDS, card_count: cards.length, cards, by_node_status: byNodeStatus };
}

interface ClientOptions {
  cards?: ChangeCard[];
  byNodeStatus?: Record<string, string>;
  changeCardsFail?: boolean;
}

const FUNCTION_BAR: HierarchyNodeRef = {
  node_id: "function::bar",
  name: "bar",
  level: "function",
  parent_id: "file::a.py",
  has_children: false,
  child_count: 0,
};

function clientWith(diffs: FunctionDiff[], options: ClientOptions = {}): EngineClient {
  const nodesById: Record<string, HierarchyNodeRef> = {
    "file::a.py": FILE_NODE,
    "function::foo": FUNCTION_NODE,
    "function::bar": FUNCTION_BAR,
  };
  return {
    ...IMPACT_CHANGES_STUB,
    ...EPICS_STUB,
    ...EPIC_BRIEF_STUB,
    ...PATTERNS_STUB,
    getNode: vi.fn(async (nodeId: string) => nodesById[nodeId] ?? null),
    getChildren: vi.fn(async () => []),
    getConnections: vi.fn(async () => []),
    getDiff: vi.fn(async () => diffs),
    getChangeCards: vi.fn(async () => {
      if (options.changeCardsFail) throw new Error("404 Not Found");
      return cardSet(options.cards ?? [], options.byNodeStatus);
    }),
    acceptDiff: vi.fn(async () => {}),
    getDiagram: vi.fn(),
    getDiagramLayout: vi.fn(),
    saveDiagramLayout: vi.fn(),
    generateDiagram: vi.fn(),
    getDiagramStatus: vi.fn(),
    listTraces: vi.fn(async () => []),
    getTrace: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    subscribeDiagram: vi.fn(() => () => {}),
    subscribeDiagramStatus: vi.fn(() => () => {}),
    subscribeTrace: vi.fn(() => () => {}),
    subscribeTraceStream: vi.fn(() => () => {}),
  };
}

const MODIFIED_FOO: FunctionDiff = {
  node_id: "function::foo",
  status: "modified",
  level: "function",
  original_source: "a",
  proposed_source: "b",
};

describe("refreshDiffs", () => {
  it("reveals a modified function's ancestor chain, shows its code, and publishes the diffs", async () => {
    const client = clientWith([MODIFIED_FOO]);

    const result = await refreshDiffs(client);

    expect(expansionStore.getBlockView("file::a.py").expand_state).toBe("expanded");
    expect(expansionStore.getBlockView("function::foo").code_visible).toBe(true);
    expect(diffOverlayStore.getDiff("function::foo")).toEqual(MODIFIED_FOO);
    expect(result).toEqual({ diffs: [MODIFIED_FOO], cards: [] });
  });

  it("skips revealing a deleted entry but still publishes it", async () => {
    const diff: FunctionDiff = {
      node_id: "function::foo",
      status: "deleted",
      level: "function",
      original_source: "a",
      proposed_source: "",
    };
    const client = clientWith([diff]);

    await refreshDiffs(client);

    expect(client.getNode).not.toHaveBeenCalled();
    expect(diffOverlayStore.getDiff("function::foo")).toEqual(diff);
  });

  it("bails out without publishing when its signal is already aborted", async () => {
    const client = clientWith([
      { node_id: "function::foo", status: "modified", original_source: "a", proposed_source: "b" },
    ]);

    const result = await refreshDiffs(client, AbortSignal.abort());

    expect(result).toBeNull();
    expect(diffOverlayStore.getIsActive()).toBe(false);
    expect(changeCardStore.getIsActive()).toBe(false);
  });

  it("resolves to null rather than rejecting when a fetch is aborted mid-flight", async () => {
    const client = clientWith([]);
    const controller = new AbortController();
    client.getDiff = vi.fn(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });

    const result = await refreshDiffs(client, controller.signal);

    expect(result).toBeNull();
  });

  it("publishes change cards onto the store alongside the diffs", async () => {
    const client = clientWith([], { cards: [card()] });

    await refreshDiffs(client);

    expect(changeCardStore.getSteps("file::a.py")).toEqual([card()]);
    expect(changeCardStore.getIsActive()).toBe(true);
  });

  it("reveals each card's ancestor chain without showing its code", async () => {
    const client = clientWith([], { cards: [card({ node_id: "function::foo" })] });

    await refreshDiffs(client);

    expect(expansionStore.getBlockView("file::a.py").expand_state).toBe("expanded");
    expect(expansionStore.getBlockView("function::foo").code_visible).toBe(false);
  });

  it("drops a card whose node already shows a full diff panel", async () => {
    const client = clientWith([MODIFIED_FOO], {
      cards: [card({ node_id: "function::foo" }), card({ node_id: "file::a.py" })],
    });

    const result = await refreshDiffs(client);

    expect(result?.cards.map((entry) => entry.node_id)).toEqual(["file::a.py"]);
    expect(changeCardStore.getSteps("function::foo")).toEqual([]);
  });

  it("still publishes the diffs when the change-card route is unavailable", async () => {
    const client = clientWith([MODIFIED_FOO], { changeCardsFail: true });

    const result = await refreshDiffs(client);

    expect(diffOverlayStore.getDiff("function::foo")).toEqual(MODIFIED_FOO);
    expect(result?.cards).toEqual([]);
  });

  it("publishes by_node_status onto hierarchyChangesStore for the plain hierarchy view", async () => {
    const client = clientWith([], { cards: [card()], byNodeStatus: { "file::a.py": "removed" } });

    await refreshDiffs(client);

    expect(hierarchyChangesStore.getStatus("file::a.py")).toBe("removed");
  });

  it("clears hierarchyChangesStore when the change-card route is unavailable", async () => {
    hierarchyChangesStore.setStatuses({ "file::a.py": "modified" });
    const client = clientWith([MODIFIED_FOO], { changeCardsFail: true });

    await refreshDiffs(client);

    expect(hierarchyChangesStore.getStatus("file::a.py")).toBeUndefined();
  });

  it("fetches a shared ancestor once for two entries under it, not once per entry", async () => {
    const modifiedBar: FunctionDiff = { ...MODIFIED_FOO, node_id: "function::bar" };
    const client = clientWith([MODIFIED_FOO, modifiedBar]);

    await refreshDiffs(client);

    const fetched = vi.mocked(client.getNode).mock.calls.map(([nodeId]) => nodeId);
    expect(fetched.filter((nodeId) => nodeId === "file::a.py")).toHaveLength(1);
  });

  it("fetches nothing when expansionStore already has the whole ancestor chain cached", async () => {
    expansionStore.cacheNodeRefs([FILE_NODE, FUNCTION_NODE]);
    const client = clientWith([MODIFIED_FOO]);

    await refreshDiffs(client);

    expect(client.getNode).not.toHaveBeenCalled();
    expect(expansionStore.getBlockView("file::a.py").expand_state).toBe("expanded");
  });
});

describe("scheduleRefreshDiffs", () => {
  it("coalesces a burst into the run in flight plus one trailing rerun, and still publishes", async () => {
    const client = clientWith([]);
    let releaseFirst = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let started = 0;
    client.getDiff = vi.fn(async () => {
      started += 1;
      if (started === 1) await firstGate;
      return [];
    });

    scheduleRefreshDiffs(client);
    scheduleRefreshDiffs(client);
    scheduleRefreshDiffs(client);
    releaseFirst();
    await vi.waitFor(() => expect(diffOverlayStore.getIsActive()).toBe(true));

    expect(started).toBe(2);
  });

  it("keeps scheduling after a failed run instead of wedging on the in-flight guard", async () => {
    const client = clientWith([]);
    client.getDiff = vi.fn().mockRejectedValueOnce(new Error("network blip")).mockResolvedValue([]);
    vi.spyOn(console, "error").mockImplementation(() => {});

    scheduleRefreshDiffs(client);
    await vi.waitFor(() => expect(client.getDiff).toHaveBeenCalledTimes(1));
    scheduleRefreshDiffs(client);

    await vi.waitFor(() => expect(diffOverlayStore.getIsActive()).toBe(true));
  });

  it("drops a run whose workspace was switched away mid-flight instead of publishing its diffs", async () => {
    const client = clientWith([MODIFIED_FOO]);
    let releaseFetch = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    client.getDiff = vi.fn(async () => {
      await gate;
      return [MODIFIED_FOO];
    });

    scheduleRefreshDiffs(client);
    resetRefreshDiffs();
    releaseFetch();
    await vi.waitFor(() => expect(client.getDiff).toHaveBeenCalledTimes(1));

    expect(diffOverlayStore.getIsActive()).toBe(false);
  });
});
