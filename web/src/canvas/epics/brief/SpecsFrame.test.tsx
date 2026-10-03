import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SpecsFrame } from "./SpecsFrame";
import { EpicsDiagramClient } from "../../../engine-client/epicsDiagramClient";
import { stageNodeId } from "../specStageHelpers";
import { IMPACT_CHANGES_STUB, EPICS_STUB, EPIC_BRIEF_STUB } from "../../../engine-client/stubEngineClient";
import type { EngineClient } from "../../../engine-client/EngineClient";
import type { EpicWorkItem } from "../../../state/types";

const ITEM_NO_STAGES: EpicWorkItem = {
  id: "EP-A-01",
  title: "Foundation",
  status: "In progress",
  kind: "epic",
  summary: "",
  group: null,
  priority: null,
  source_ref: "plan/epics/a.md",
  url: null,
  requirements: [],
  children: [],
  links: [],
  stages: [],
};

const ITEM_WITH_TASKS_STAGE: EpicWorkItem = {
  ...ITEM_NO_STAGES,
  stages: [
    {
      kind: "tasks",
      name: "008-feature",
      status: null,
      done: 1,
      total: 2,
      sections: [],
      source_ref: "specs/008-feature/tasks.md",
    },
  ],
};

const EXPANDED_TASKS_STAGE: EpicWorkItem = {
  ...ITEM_NO_STAGES,
  stages: [
    {
      ...ITEM_WITH_TASKS_STAGE.stages[0],
      sections: [
        {
          title: "Phase 1",
          items: [
            { id: "T001", text: "T001 [P] [US1] do it", done: true, story: "US1", parallel: true },
          ],
          done: 1,
          total: 1,
        },
      ],
    },
  ],
};

function innerClient(getEpicsItem: EngineClient["getEpicsItem"]): EngineClient {
  return {
    ...IMPACT_CHANGES_STUB,
    ...EPICS_STUB,
    ...EPIC_BRIEF_STUB,
    getNode: async () => null,
    getChildren: async () => [],
    getConnections: async () => [],
    getDiff: async () => [],
    acceptDiff: async () => {},
    getDiagram: (() => Promise.resolve({})) as unknown as EngineClient["getDiagram"],
    getDiagramLayout: async () => ({}),
    saveDiagramLayout: async () => {},
    listTraces: async () => [],
    getTrace: async () => ({ id: "", entry: "", created_at: "", status: "ok", steps: [] }),
    subscribe: () => () => {},
    subscribeTrace: () => () => {},
    subscribeTraceStream: () => () => {},
    subscribeDiagram: () => () => {},
    subscribeDiagramStatus: () => () => {},
    subscribeDiagramOutput: () => () => {},
    subscribeAgents: () => () => {},
    getEpicsItem,
  };
}

describe("SpecsFrame", () => {
  it("auto-fetches the item on mount so stages render without a prior box-graph fetch", async () => {
    const getEpicsItem = vi.fn(async () => ITEM_WITH_TASKS_STAGE);
    const client = new EpicsDiagramClient(innerClient(getEpicsItem));

    render(<SpecsFrame itemId="EP-A-01" client={client} />);

    await waitFor(() => expect(screen.getByTestId("epic-brief-specs-frame")).toBeTruthy());
    expect(getEpicsItem).toHaveBeenCalledWith("EP-A-01", undefined);
  });

  it("renders nothing for a stage-less item", async () => {
    const client = new EpicsDiagramClient(innerClient(async () => ITEM_NO_STAGES));
    await client.fetchItem("EP-A-01");

    await act(async () => {
      render(<SpecsFrame itemId="EP-A-01" client={client} />);
    });

    expect(screen.queryByTestId("epic-brief-specs-frame")).toBeNull();
  });

  it("a stage chip expands to its sections, fetching the exact stage node id", async () => {
    const getEpicsItem = vi.fn(async (_id: string, expand?: string) =>
      expand ? EXPANDED_TASKS_STAGE : ITEM_WITH_TASKS_STAGE,
    );
    const client = new EpicsDiagramClient(innerClient(getEpicsItem));
    await client.fetchItem("EP-A-01");
    await act(async () => {
      render(<SpecsFrame itemId="EP-A-01" client={client} />);
    });
    expect(screen.getByTestId("epic-brief-specs-frame")).toBeTruthy();
    expect(screen.queryByTestId("epic-brief-specs-sections")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("epic-brief-specs-stage-chip"));
    });

    await waitFor(() => expect(screen.getByTestId("epic-brief-specs-sections")).toBeTruthy());
    expect(getEpicsItem).toHaveBeenCalledWith("EP-A-01", stageNodeId("008-feature", "tasks"));
    expect(screen.queryByTestId("epic-brief-specs-items")).toBeNull();
  });

  it("a section expands to its items without an extra fetch, showing [P]/story", async () => {
    const getEpicsItem = vi.fn(async (_id: string, expand?: string) =>
      expand ? EXPANDED_TASKS_STAGE : ITEM_WITH_TASKS_STAGE,
    );
    const client = new EpicsDiagramClient(innerClient(getEpicsItem));
    await client.fetchItem("EP-A-01");
    await act(async () => {
      render(<SpecsFrame itemId="EP-A-01" client={client} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("epic-brief-specs-stage-chip"));
    });
    await waitFor(() => expect(screen.getByTestId("epic-brief-specs-section-chip")).toBeTruthy());
    expect(getEpicsItem).toHaveBeenCalledTimes(2); // one initial fetch, one for the stage expand

    fireEvent.click(screen.getByTestId("epic-brief-specs-section-chip"));

    await waitFor(() => expect(screen.getByTestId("epic-brief-specs-item")).toBeTruthy());
    expect(getEpicsItem).toHaveBeenCalledTimes(2); // expanding the section fetched nothing new
    const item = screen.getByTestId("epic-brief-specs-item");
    expect(item.textContent).toContain("T001");
    expect(item.querySelector('[data-testid="epic-brief-specs-item-parallel"]')).toBeTruthy();
    expect(item.querySelector('[data-testid="epic-brief-specs-item-story"]')?.textContent).toBe(
      "US1",
    );
  });

  it("copies a spec item's [P]/story/text via its copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const getEpicsItem = vi.fn(async (_id: string, expand?: string) =>
      expand ? EXPANDED_TASKS_STAGE : ITEM_WITH_TASKS_STAGE,
    );
    const client = new EpicsDiagramClient(innerClient(getEpicsItem));
    await client.fetchItem("EP-A-01");
    await act(async () => {
      render(<SpecsFrame itemId="EP-A-01" client={client} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("epic-brief-specs-stage-chip"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("epic-brief-specs-section-chip"));
    });
    await waitFor(() => expect(screen.getByTestId("epic-brief-specs-item")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("[P]\nUS1\nT001 [P] [US1] do it"));
  });
});
