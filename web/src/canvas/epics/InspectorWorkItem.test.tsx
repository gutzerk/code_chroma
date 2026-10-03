import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { EpicsDiagramClient } from "../../engine-client/epicsDiagramClient";
import { InspectorWorkItem } from "./InspectorWorkItem";
import { epicBriefPanelStore } from "../doc/epicBriefPanelStore";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { EpicWorkItem } from "../../state/types";

function itemOf(overrides: Partial<EpicWorkItem> & { id: string }): EpicWorkItem {
  return {
    title: "Epic",
    status: "Planned",
    kind: "epic",
    summary: "",
    group: "settings",
    priority: "Medium",
    source_ref: "",
    url: null,
    requirements: [],
    children: [],
    links: [],
    stages: [],
    ...overrides,
  };
}

const WORK_ITEM: EpicWorkItem = itemOf({
  id: "EP-3",
  summary: "Canvas customization.",
  requirements: [
    { id: "cr1", text: "Theme controls", kind: "checklist", done: null, source_ref: "" },
    { id: "cr2", text: "Element budget", kind: "checklist", done: null, source_ref: "" },
  ],
  children: [
    itemOf({ id: "EP-3-01", title: "theme controls", kind: "story" }),
  ],
  links: [
    { id: "EP-1", title: "Map", relation: "depends_on", in_index: true },
  ],
});

function innerClient(): EngineClient {
  return {
    getEpicsItem: async () => WORK_ITEM,
  } as unknown as EngineClient;
}

describe("InspectorWorkItem (010-epics-tree-render Part 5)", () => {
  const renderItem = (itemId = "EP-3") =>
    render(
      <EngineClientProvider repoId="default" client={innerClient()}>
        <InspectorWorkItem itemId={itemId} client={new EpicsDiagramClient(innerClient())} />
      </EngineClientProvider>,
    );

  it("renders the work item's full text from its item id", async () => {
    renderItem();

    await waitFor(() => expect(screen.getByTestId("inspector-work-item")).toBeInTheDocument());
    expect(screen.getByTestId("inspector-work-item-summary")).toHaveTextContent("Canvas customization.");
    const criteria = screen.getByTestId("inspector-work-item-criteria");
    expect(withinList(criteria, "Theme controls")).toBe(true);
    expect(screen.getByText("EP-3-01")).toBeInTheDocument();
    expect(screen.getByText(/depends_on → EP-1/)).toBeInTheDocument();
    expect(screen.getByTestId("inspector-work-item-status")).toHaveTextContent(/Planned.*Medium.*settings/);
  });

  it("opens the AI brief panel from its button", async () => {
    const open = vi.spyOn(epicBriefPanelStore, "open").mockImplementation(() => {});
    renderItem();

    await waitFor(() => expect(screen.getByTestId("inspector-work-item-open-brief")).toBeInTheDocument());
    screen.getByTestId("inspector-work-item-open-brief").click();

    expect(open).toHaveBeenCalledWith("EP-3");
    open.mockRestore();
  });

  it("renders spec/tasks stages and skips the empty note for a stage-only item", async () => {
    const stageOnly = itemOf({
      id: "EP-3",
      stages: [
        {
          kind: "tasks",
          name: "001-canvas-customization",
          status: null,
          done: 1,
          total: 6,
          source_ref: "",
          sections: [
            {
              title: "US1",
              done: 1,
              total: 6,
              items: [
                { id: "T001", text: "Confirm web runs", done: true, story: "US1", parallel: false },
                { id: "T002", text: "Create prefs type", done: null, story: "US1", parallel: true },
              ],
            },
          ],
        },
      ],
    });
    const client = {
      getEpicsItem: async () => stageOnly,
    } as unknown as EngineClient;

    render(
      <EngineClientProvider repoId="default" client={client}>
        <InspectorWorkItem itemId="EP-3" client={new EpicsDiagramClient(client)} />
      </EngineClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("inspector-work-item-stages")).toBeInTheDocument(),
    );
    // Rolled-up stage header (spec/tasks) + per-item done glyphs.
    expect(screen.getByTestId("inspector-work-item-stages")).toHaveTextContent("Tasks");
    expect(screen.getByText(/☑ Confirm web runs/)).toBeInTheDocument();
    expect(screen.getByText(/◇ Create prefs type/)).toBeInTheDocument();
    // A stage-only item (epic whose brief is its specs) must not read as "nothing to show".
    expect(screen.queryByTestId("inspector-work-item-empty")).not.toBeInTheDocument();
  });
});

function withinList(container: HTMLElement, text: string): boolean {
  return Array.from(container.querySelectorAll("li")).some((li) => li.textContent?.includes(text));
}
