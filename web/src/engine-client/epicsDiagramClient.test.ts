import { describe, expect, it, vi } from "vitest";
import { EpicsDiagramClient } from "./epicsDiagramClient";
import { IMPACT_CHANGES_STUB, EPICS_STUB, EPIC_BRIEF_STUB } from "./stubEngineClient";
import type { EngineClient } from "./EngineClient";
import type { EpicStage, EpicWorkItem } from "../state/types";

const ITEM: EpicWorkItem = {
  id: "EP-A-01",
  title: "Foundation",
  status: "In progress",
  kind: "epic",
  summary: "",
  group: "platform",
  priority: null,
  source_ref: "plan/epics/a.md",
  url: null,
  requirements: [{ id: "r1", text: "one", kind: "checklist", done: true, source_ref: "a.md" }],
  children: [],
  links: [
    { id: "EP-A-02", relation: "depends_on", title: "the other epic", in_index: true },
    { id: "EP-Z-99", relation: "enables", title: "a future epic", in_index: false },
  ],
  stages: [],
};

function innerClient(getEpicsItem = vi.fn(async () => ITEM)): EngineClient {
  return {
    ...IMPACT_CHANGES_STUB,
    ...EPICS_STUB,
    ...EPIC_BRIEF_STUB,
    getNode: vi.fn(async () => null),
    getChildren: vi.fn(async () => []),
    getConnections: async () => [],
    getDiff: async () => [],
    acceptDiff: async () => {},
    getDiagram: (() => Promise.resolve({})) as unknown as EngineClient["getDiagram"],
    getDiagramLayout: async () => ({}),
    saveDiagramLayout: async () => {},
    listTraces: async () => [],
    getTrace: async () => ({ id: "", entry: "", created_at: "", status: "ok", steps: [] }),
    subscribe: () => () => {},
    subscribeDiagram: () => () => {},
    subscribeDiagramStatus: () => () => {},
    subscribeDiagramOutput: () => () => {},
    subscribeTrace: () => () => {},
    subscribeTraceStream: () => () => {},
    subscribeAgents: () => () => {},
    getEpicsItem,
  };
}

describe("EpicsDiagramClient.fetchItem", () => {
  it("issues exactly one item request on first expansion", async () => {
    const getEpicsItem = vi.fn(async () => ITEM);
    const client = new EpicsDiagramClient(innerClient(getEpicsItem));

    await client.fetchItem("EP-A-01");

    expect(getEpicsItem).toHaveBeenCalledTimes(1);
  });

  it("issues no further request on a second expansion of the same item", async () => {
    const getEpicsItem = vi.fn(async () => ITEM);
    const client = new EpicsDiagramClient(innerClient(getEpicsItem));
    await client.fetchItem("EP-A-01");

    await client.fetchItem("EP-A-01");

    expect(getEpicsItem).toHaveBeenCalledTimes(1);
  });

  it("dedupes two concurrent fetches of the same id onto one request", async () => {
    const getEpicsItem = vi.fn(async () => ITEM);
    const client = new EpicsDiagramClient(innerClient(getEpicsItem));

    await Promise.all([client.fetchItem("EP-A-01"), client.fetchItem("EP-A-01")]);

    expect(getEpicsItem).toHaveBeenCalledTimes(1);
  });
});

describe("EpicsDiagramClient guard (FR-035, D-07)", () => {
  it("never passes an epic-* id to inner.getNode or inner.getChildren", async () => {
    const inner = innerClient();
    const client = new EpicsDiagramClient(inner);

    await client.getNode("epic-bogus::whatever");
    await client.getChildren("epic-bogus::whatever");

    expect(inner.getNode).not.toHaveBeenCalled();
    expect(inner.getChildren).not.toHaveBeenCalled();
  });

  it("forwards a non-epic id to inner verbatim", async () => {
    const inner = innerClient();
    const client = new EpicsDiagramClient(inner);

    await client.getNode("function::foo");
    await client.getChildren("function::foo");

    expect(inner.getNode).toHaveBeenCalledWith("function::foo");
    expect(inner.getChildren).toHaveBeenCalledWith("function::foo");
  });
});

describe("EpicsDiagramClient.registerStub (D-14)", () => {
  it("registers a stub for a link with no index entry", () => {
    const client = new EpicsDiagramClient(innerClient());

    client.registerStub({ id: "EP-Z-99", relation: "enables", title: "a future epic", in_index: false });

    expect(client.getStub("EP-Z-99")).toEqual({ id: "EP-Z-99", relation: "enables", title: "a future epic" });
  });

  it("produces no stub for a link already resolved against the index", () => {
    const client = new EpicsDiagramClient(innerClient());
    client.setIndex([{ id: "EP-A-02", title: "Other", status: "Planned", kind: "epic", group: null }]);

    client.registerStub({ id: "EP-A-02", relation: "depends_on", title: "wording", in_index: true });

    expect(client.getStub("EP-A-02")).toBeUndefined();
  });

  it("promoting a stub (fetching it) clears it from the stub map", async () => {
    const client = new EpicsDiagramClient(innerClient());
    client.registerStub({ id: "EP-A-01", relation: "depends_on", title: "wording", in_index: false });
    expect(client.getStub("EP-A-01")).toBeDefined();

    await client.fetchItem("EP-A-01");

    expect(client.getStub("EP-A-01")).toBeUndefined();
    expect(client.getItem("EP-A-01")).toEqual(ITEM);
  });
});

describe("EpicsDiagramClient.fetchItem stage sections merge", () => {
  it("keeps a previously fetched stage's sections when a different stage is expanded next", async () => {
    const specSections = [
      {
        title: "Summary",
        items: [{ id: "s1", text: "spec text", done: null, story: null, parallel: false }],
        done: null,
        total: null,
      },
    ];
    const tasksSections = [
      {
        title: "Checklist",
        items: [{ id: "t1", text: "task text", done: false, story: null, parallel: false }],
        done: 0,
        total: 1,
      },
    ];
    const stagesFor = (expand?: string): EpicStage[] => [
      { kind: "spec", name: "spec", status: null, done: null, total: null, source_ref: "a.md",
        sections: expand === "spec-node" ? specSections : [] },
      { kind: "tasks", name: "tasks", status: null, done: null, total: null, source_ref: "a.md",
        sections: expand === "tasks-node" ? tasksSections : [] },
    ];
    const getEpicsItem = vi.fn(
      async (_id: string, expand?: string): Promise<EpicWorkItem> => ({ ...ITEM, stages: stagesFor(expand) }),
    );
    const client = new EpicsDiagramClient(innerClient(getEpicsItem));

    await client.fetchItem("EP-A-01", "spec-node");
    await client.fetchItem("EP-A-01", "tasks-node");

    const stages = client.getItem("EP-A-01")?.stages ?? [];
    expect(stages.find((s) => s.kind === "spec")?.sections).toEqual(specSections);
    expect(stages.find((s) => s.kind === "tasks")?.sections).toEqual(tasksSections);
  });
});

describe("EpicsDiagramClient.clearCache", () => {
  it("clears cached items and stubs so a refetch reflects new content", async () => {
    const getEpicsItem = vi.fn(async () => ITEM);
    const client = new EpicsDiagramClient(innerClient(getEpicsItem));
    await client.fetchItem("EP-A-01");

    client.clearCache();
    await client.fetchItem("EP-A-01");

    expect(getEpicsItem).toHaveBeenCalledTimes(2);
  });
});

describe("EpicsDiagramClient tree shape", () => {
  it("derives has_children/child_count for a work item from what actually fetched", async () => {
    const client = new EpicsDiagramClient(innerClient());
    client.setIndex([{ id: "EP-A-01", title: "Foundation", status: "In progress", kind: "epic", group: "platform" }]);

    const children = await client.getChildren("epic::EP-A-01");

    expect(children).toEqual([
      {
        node_id: "epic-group::EP-A-01::requirements",
        name: "Requirements",
        level: "function",
        parent_id: "epic::EP-A-01",
        has_children: true,
        child_count: 1,
      },
    ]);
  });
});
