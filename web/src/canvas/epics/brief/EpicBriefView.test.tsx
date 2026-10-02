import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EpicBriefView } from "./EpicBriefView";
import * as availability from "../../../llm-settings/useGroupAvailability";
import { EngineClientProvider } from "../../../engine-client/EngineClientContext";
import { EpicsDiagramClient } from "../../../engine-client/epicsDiagramClient";
import {
  DIAGRAM_STUB,
  EPICS_STUB,
  RESEARCH_STUB,
  EPIC_BRIEF_STUB,
} from "../../../engine-client/stubEngineClient";
import type { EngineClient } from "../../../engine-client/EngineClient";
import type { EpicBrief, EpicBriefJobState, EpicWorkItem } from "../../../state/types";

vi.mock("../../../llm-settings/useGroupAvailability", () => ({
  useGroupAvailability: vi.fn(),
  NO_PROVIDER_HINT: "no provider hint",
  guardedClick: (disabled: boolean, onClick: () => void) => () => {
    if (!disabled) onClick();
  },
  providerGate: (providerAvailable: boolean) => ({
    "aria-disabled": !providerAvailable,
    title: providerAvailable ? undefined : "no provider hint",
  }),
}));

const useGroupAvailability = vi.mocked(availability.useGroupAvailability);
useGroupAvailability.mockReturnValue(true);

afterEach(() => {
  useGroupAvailability.mockReturnValue(true);
});

const STAGELESS_ITEM: EpicWorkItem = {
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

const BRIEF: EpicBrief = {
  epic_id: "EP-A-01",
  generated_at: "",
  problem: ["the problem statement"],
  component: "application",
  spokes: [
    { spoke: "application", role: "the control plane" },
    { spoke: "inference", role: "the model placement" },
  ],
  scope: [
    {
      id: "scope-config",
      title: "Shared config resolver",
      description: "one resolver",
      in_scope: true,
      tasks_source: "spec",
      out_of_scope_ref: null,
      tasks: [
        { id: "T001", text: "extract resolver", parallel: false, repo: "backend", stage: null },
        { id: "T002", text: "test resolver", parallel: true, repo: "backend", stage: null },
      ],
    },
    {
      id: "scope-health",
      title: "Shared health check",
      description: "one shape",
      in_scope: true,
      tasks_source: "draft",
      out_of_scope_ref: null,
      tasks: [{ id: "T003", text: "define response type", parallel: false, repo: null, stage: null }],
    },
  ],
  prep_tasks: [],
  dependencies: [],
  acceptance: [
    { id: "AC-01", text: "closed criterion", done: true, closes_scope_id: "scope-config" },
    { id: "AC-02", text: "unclosed criterion", done: false, closes_scope_id: null },
  ],
};

function clientWith(job: EpicBriefJobState, epicsItem: EpicWorkItem = STAGELESS_ITEM): EngineClient {
  return {
    ...DIAGRAM_STUB,
    ...EPICS_STUB,
    ...RESEARCH_STUB,
    ...EPIC_BRIEF_STUB,
    getNode: async () => null,
    getChildren: async () => [],
    getConnections: async () => [],
    getDiff: async () => [],
    acceptDiff: async () => {},
    listTraces: async () => [],
    getTrace: async () => ({ id: "", entry: "", created_at: "", status: "ok", steps: [] }),
    subscribe: () => () => {},
    subscribeTrace: () => () => {},
    subscribeTraceStream: () => () => {},
    getEpicBrief: async () => job,
    getEpicsItem: async () => epicsItem,
  };
}

// SpecsFrame reads client.getItem(itemId) from cache -- pre-fetching it here mirrors what
// EpicsView.tsx's own focusEpic() already does for the real box-graph/brief-toggle flow.
async function renderView(job: EpicBriefJobState, epicsItem: EpicWorkItem = STAGELESS_ITEM) {
  const engineClient = clientWith(job, epicsItem);
  const client = new EpicsDiagramClient(engineClient);
  await client.fetchItem("EP-A-01");
  return render(
    <EngineClientProvider repoId="default" client={engineClient}>
      <EpicBriefView itemId="EP-A-01" client={client} />
    </EngineClientProvider>,
  );
}

describe("EpicBriefView", () => {
  it("renders scope cards in a row, each with its own tasks in a column", async () => {
    await renderView({ job_key: "main:EP-A-01", state: "idle", error: null, brief: BRIEF });

    await waitFor(() => expect(screen.getAllByTestId("epic-brief-scope-item")).toHaveLength(2));
    const [firstCard] = screen.getAllByTestId("epic-brief-scope-item");
    expect(firstCard.querySelectorAll('[data-testid="epic-brief-task-chip"]')).toHaveLength(2);
  });

  it("a criterion with closes_scope_id: null renders the red gap badge", async () => {
    await renderView({ job_key: "main:EP-A-01", state: "idle", error: null, brief: BRIEF });

    await waitFor(() => expect(screen.getByTestId("epic-brief-gap-badge")).toBeTruthy());
  });

  it("pools is_test tasks into the labeled Testing subgroup, off the feature cards", async () => {
    const brief: EpicBrief = {
      ...BRIEF,
      scope: [
        {
          id: "scope-config",
          title: "Shared config resolver",
          description: "one resolver",
          in_scope: true,
          tasks_source: "spec",
          out_of_scope_ref: null,
          tasks: [
            { id: "T001", text: "extract resolver", parallel: false, repo: "backend", stage: null },
            { id: "T002", text: "test resolver", parallel: true, repo: "backend", stage: null, is_test: true },
          ],
        },
      ],
    };
    await renderView({ job_key: "main:EP-A-01", state: "idle", error: null, brief });

    await waitFor(() => expect(screen.getByTestId("epic-brief-testing-row")).toBeTruthy());
    expect(screen.getByTestId("epic-brief-testing-row").textContent).toContain("test resolver");
    // The test task no longer counts toward the feature card's own tasks.
    const card = screen.getByTestId("epic-brief-scope-item");
    expect(card.querySelectorAll('[data-testid="epic-brief-task-chip"]')).toHaveLength(1);
    expect(card.textContent).not.toContain("test resolver");
  });

  it("renders no Testing subgroup when no task is marked is_test", async () => {
    await renderView({ job_key: "main:EP-A-01", state: "idle", error: null, brief: BRIEF });

    await waitFor(() => expect(screen.getByTestId("epic-brief-view")).toBeTruthy());
    expect(screen.queryByTestId("epic-brief-testing-row")).toBeNull();
  });

  it("tasks_source: draft renders the dashed-card treatment", async () => {
    await renderView({ job_key: "main:EP-A-01", state: "idle", error: null, brief: BRIEF });

    await waitFor(() => expect(screen.getAllByTestId("epic-brief-scope-item")).toHaveLength(2));
    const draftCard = screen
      .getAllByTestId("epic-brief-scope-item")
      .find((card) => card.textContent?.includes("Shared health check"));
    expect(draftCard?.className).toContain("epic-brief-scope-item--draft");
  });

  it("renders the component and spokes banner", async () => {
    await renderView({ job_key: "main:EP-A-01", state: "idle", error: null, brief: BRIEF });

    await waitFor(() => expect(screen.getByTestId("epic-brief-spokes-frame")).toBeTruthy());
    expect(screen.getByTestId("epic-brief-spokes-frame").textContent).toContain(
      "Spokes / parts — application",
    );
    expect(screen.getByTestId("epic-brief-spokes-frame").textContent).toContain("application");
    expect(screen.getByTestId("epic-brief-spokes-frame").textContent).toContain("inference");
  });

  it("renders the repo tag on tasks that carry one, and skips it on those that don't", async () => {
    await renderView({ job_key: "main:EP-A-01", state: "idle", error: null, brief: BRIEF });

    await waitFor(() => expect(screen.getAllByTestId("epic-brief-task-chip")).toHaveLength(3));
    expect(screen.getAllByTestId("epic-brief-task-repo")).toHaveLength(2);
    const chips = Array.from(
      screen.getAllByTestId("epic-brief-task-chip").map((chip) => chip.textContent ?? ""),
    );
    const backendChip = chips.find((text) => text.includes("extract resolver"));
    expect(backendChip).toContain("backend");
    const nullRepoChip = chips.find((text) => text.includes("define response type"));
    expect(nullRepoChip).not.toContain("backend");
  });

  it("shows the generate affordance when no brief exists yet", async () => {
    await renderView({ job_key: "", state: "idle", error: null, brief: null });

    await waitFor(() => expect(screen.getByTestId("epic-brief-generate-button")).toBeTruthy());
  });

  it("shows a Regenerate button on a generated brief that forces a fresh run", async () => {
    let forced = false;
    const engineClient = clientWith({
      job_key: "main:EP-A-01",
      state: "idle",
      error: null,
      brief: BRIEF,
    });
    engineClient.generateEpicBrief = async (_itemId: string, force?: boolean) => {
      forced = force ?? false;
      return { job_key: "main:EP-A-01", state: "generating", error: null, brief: null };
    };
    const client = new EpicsDiagramClient(engineClient);
    await client.fetchItem("EP-A-01");
    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <EpicBriefView itemId="EP-A-01" client={client} />
      </EngineClientProvider>,
    );

    const button = await screen.findByTestId("epic-brief-regenerate-button");
    button.click();
    expect(forced).toBe(true);
  });

  it("the Specs frame is absent for a stage-less item in the empty (no-brief) state", async () => {
    await renderView({ job_key: "", state: "idle", error: null, brief: null });

    await waitFor(() => expect(screen.getByTestId("epic-brief-generate-button")).toBeTruthy());
    expect(screen.queryByTestId("epic-brief-specs-frame")).toBeNull();
  });

  it("the Specs frame is absent for a stage-less item in the generated brief", async () => {
    await renderView({ job_key: "main:EP-A-01", state: "idle", error: null, brief: BRIEF });

    await waitFor(() => expect(screen.getByTestId("epic-brief-view")).toBeTruthy());
    expect(screen.queryByTestId("epic-brief-specs-frame")).toBeNull();
  });

  it("shows a Stop button while a brief is generating", async () => {
    await renderView({ job_key: "main:EP-A-01", state: "generating", error: null, brief: null });

    await waitFor(() => expect(screen.getByTestId("epic-brief-generating")).toBeTruthy());
    expect(
      screen.getByRole("button", { name: "Stop" }),
    ).toBeInTheDocument();
  });

  it("copies each block's text via its copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    await renderView({ job_key: "main:EP-A-01", state: "idle", error: null, brief: BRIEF });
    await waitFor(() => expect(screen.getByTestId("epic-brief-problem-frame")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Copy the problem statement" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("the problem statement"));

    fireEvent.click(screen.getByRole("button", { name: "Copy Shared config resolver" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Shared config resolver"));

    fireEvent.click(screen.getByRole("button", { name: "Copy closed criterion" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("closed criterion"));
  });

  it("copies a scope task's text via its chip's copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    await renderView({ job_key: "main:EP-A-01", state: "idle", error: null, brief: BRIEF });
    await waitFor(() => expect(screen.getAllByTestId("epic-brief-task-chip")).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "Copy [P] backend T002 test resolver" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("[P] backend T002 test resolver"),
    );
  });

  it("marks Generate aria-disabled, but keyboard-reachable, when no provider CLI is available", async () => {
    useGroupAvailability.mockReturnValue(false);
    await renderView({ job_key: "", state: "idle", error: null, brief: null });

    const button = await screen.findByTestId("epic-brief-generate-button");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
  });

  it("ignores a click on Generate when no provider CLI is available", async () => {
    useGroupAvailability.mockReturnValue(false);
    let generateCalls = 0;
    const engineClient = clientWith({ job_key: "", state: "idle", error: null, brief: null });
    engineClient.generateEpicBrief = async () => {
      generateCalls += 1;
      return { job_key: "", state: "generating", error: null, brief: null };
    };
    const client = new EpicsDiagramClient(engineClient);
    await client.fetchItem("EP-A-01");
    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <EpicBriefView itemId="EP-A-01" client={client} />
      </EngineClientProvider>,
    );

    (await screen.findByTestId("epic-brief-generate-button")).click();

    expect(generateCalls).toBe(0);
  });

  it("marks Regenerate aria-disabled, but keyboard-reachable, when no provider CLI is available", async () => {
    useGroupAvailability.mockReturnValue(false);
    await renderView({ job_key: "main:EP-A-01", state: "idle", error: null, brief: BRIEF });

    const button = await screen.findByTestId("epic-brief-regenerate-button");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
  });

  it("ignores a click on Regenerate when no provider CLI is available", async () => {
    useGroupAvailability.mockReturnValue(false);
    let generateCalls = 0;
    const engineClient = clientWith({
      job_key: "main:EP-A-01", state: "idle", error: null, brief: BRIEF,
    });
    engineClient.generateEpicBrief = async () => {
      generateCalls += 1;
      return { job_key: "main:EP-A-01", state: "generating", error: null, brief: null };
    };
    const client = new EpicsDiagramClient(engineClient);
    await client.fetchItem("EP-A-01");
    render(
      <EngineClientProvider repoId="default" client={engineClient}>
        <EpicBriefView itemId="EP-A-01" client={client} />
      </EngineClientProvider>,
    );

    (await screen.findByTestId("epic-brief-regenerate-button")).click();

    expect(generateCalls).toBe(0);
  });

  it("shows the error from a failed Regenerate even though a brief is already on screen", async () => {
    await renderView({
      job_key: "main:EP-A-01", state: "error", error: "claude: command not found", brief: BRIEF,
    });

    await waitFor(() =>
      expect(screen.getByTestId("epic-brief-regenerate-error").textContent).toBe(
        "claude: command not found",
      ),
    );
  });
});
