import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as availability from "../llm-settings/useGroupAvailability";
import { WikiGeneralNotice } from "./WikiGeneralNotice";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import type { EngineClient } from "../engine-client/EngineClient";
import type { DiagramGenerationStatus, WikiGeneralStatus } from "../state/types";
import {
  DIAGRAM_STUB,
  EPICS_STUB,
  EPIC_BRIEF_STUB,
} from "../engine-client/stubEngineClient";
import { agentStore } from "../agents/agentStore";
import { workspaceStore } from "../agents/workspaceStore";

vi.mock("../llm-settings/useGroupAvailability", () => ({
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

const NOT_GENERATED: WikiGeneralStatus = {
  state: "idle",
  error: null,
  has_wiki_general: false,
  stale: false,
  empty: false,
};

function clientWith(overrides: Partial<EngineClient> = {}): EngineClient {
  return {
    ...DIAGRAM_STUB,
    ...EPICS_STUB,
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
    getWikiGeneralStatus: async () => NOT_GENERATED,
    ...overrides,
  };
}

function renderNotice(overrides: Partial<EngineClient> = {}) {
  return render(
    <EngineClientProvider repoId="default" client={clientWith(overrides)}>
      <WikiGeneralNotice />
    </EngineClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  workspaceStore.reset();
  agentStore.reset();
  useGroupAvailability.mockReturnValue(true);
});

describe("WikiGeneralNotice", () => {
  it("stays silent once a valid wiki-general already exists", async () => {
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "idle",
        error: null,
        has_wiki_general: true,
        stale: false,
        empty: false,
      }),
    });

    await waitFor(() => expect(screen.queryByTestId("wiki-general-notice")).toBeNull());
  });

  it("stays silent for a repo with no real code yet, even though nothing is generated", async () => {
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "idle",
        error: null,
        has_wiki_general: false,
        stale: false,
        empty: true,
      }),
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByTestId("wiki-general-notice")).toBeNull();
  });

  it("still shows the generating UI for a repo an interactive run started on directly", async () => {
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "generating",
        error: null,
        has_wiki_general: false,
        stale: false,
        empty: true,
      }),
    });

    expect(await screen.findByTestId("wiki-general-notice")).toHaveTextContent(
      "Building the architecture map",
    );
  });

  it("stays silent for a read-only workspace even when nothing is generated yet", async () => {
    agentStore.setActiveWorkspace("pr-7");
    workspaceStore.setStatus({ id: "pr-7", state: "ready", progress: "", error: null, read_only: true });

    renderNotice();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByTestId("wiki-general-notice")).toBeNull();
  });

  it("shows the empty state with a Generate button", async () => {
    renderNotice();

    expect(await screen.findByTestId("wiki-general-notice")).toHaveTextContent(
      "Architecture wiki not created yet",
    );
    expect(screen.getByTestId("wiki-general-generate")).toBeInTheDocument();
    expect(screen.queryByTestId("wiki-general-stop")).toBeNull();
  });

  it("clicking Generate starts the run", async () => {
    let generateCalls = 0;
    renderNotice({
      generateDiagram: async (): Promise<DiagramGenerationStatus> => {
        generateCalls += 1;
        return { state: "generating", error: null };
      },
    });
    await screen.findByTestId("wiki-general-generate");

    fireEvent.click(screen.getByTestId("wiki-general-generate"));

    await waitFor(() => expect(generateCalls).toBe(1));
    expect(await screen.findByTestId("wiki-general-stop")).toBeInTheDocument();
  });

  it("shows a status line and a Stop button while generating", async () => {
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "generating",
        error: null,
        has_wiki_general: false,
        stale: false,
        empty: false,
      }),
    });

    expect(await screen.findByTestId("wiki-general-notice")).toHaveTextContent(
      "Building the architecture map",
    );
    expect(screen.getByTestId("wiki-general-stop")).toBeInTheDocument();
  });

  it("shows an indeterminate bar while generating with no progress line yet", async () => {
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "generating",
        error: null,
        has_wiki_general: false,
        stale: false,
        empty: false,
      }),
    });

    const bar = await screen.findByTestId("wiki-general-progress");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar).not.toHaveAttribute("role", "progressbar");
  });

  it("shows a real progress bar once the pipeline emits a completion line", async () => {
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "generating",
        error: null,
        has_wiki_general: false,
        stale: false,
        empty: false,
      }),
      getDiagramOutput: async () => ["⏺ write-c3 (39 components)", "→ 12/39 c3:auth"],
    });

    const bar = await screen.findByTestId("wiki-general-progress");
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "12"));
    expect(bar).toHaveAttribute("role", "progressbar");
    expect(bar).toHaveAttribute("aria-valuemax", "39");
    expect(await screen.findByTestId("wiki-general-notice")).toHaveTextContent("12 / 39");
  });

  it("shows an estimated time remaining once a job has completed", async () => {
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "generating",
        error: null,
        has_wiki_general: false,
        stale: false,
        empty: false,
      }),
      getDiagramOutput: async () => ["⏺ write-c3 (39 components)", "→ 12/39 c3:auth"],
    });

    await waitFor(() =>
      expect(screen.getByTestId("wiki-general-notice")).toHaveTextContent(/left\)/),
    );
  });

  it("shows no estimate yet while the bar is still indeterminate", async () => {
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "generating",
        error: null,
        has_wiki_general: false,
        stale: false,
        empty: false,
      }),
    });

    expect(await screen.findByTestId("wiki-general-notice")).not.toHaveTextContent(/left\)/);
  });

  it("clicking Stop cancels the run", async () => {
    let cancelCalls = 0;
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "generating",
        error: null,
        has_wiki_general: false,
        stale: false,
        empty: false,
      }),
      cancelDiagram: async (): Promise<DiagramGenerationStatus> => {
        cancelCalls += 1;
        return { state: "idle", error: null };
      },
    });
    await screen.findByTestId("wiki-general-stop");

    fireEvent.click(screen.getByTestId("wiki-general-stop"));

    await waitFor(() => expect(cancelCalls).toBe(1));
  });

  it("appends a failed run's error to the empty-state message", async () => {
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "error",
        error: "claude CLI not found on PATH",
        has_wiki_general: false,
        stale: false,
        empty: false,
      }),
    });

    expect(await screen.findByTestId("wiki-general-notice")).toHaveTextContent(
      "claude CLI not found on PATH",
    );
  });

  it("shows a stale banner with an Update button once a commit lands", async () => {
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "idle",
        error: null,
        has_wiki_general: true,
        stale: true,
        empty: false,
      }),
    });

    expect(await screen.findByTestId("wiki-general-notice")).toHaveTextContent(
      "Architecture wiki is outdated",
    );
    expect(screen.getByTestId("wiki-general-update")).toBeInTheDocument();
    expect(screen.queryByTestId("wiki-general-generate")).toBeNull();
  });

  it("clicking Update starts the incremental-update run", async () => {
    let updateCalls = 0;
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "idle",
        error: null,
        has_wiki_general: true,
        stale: true,
        empty: false,
      }),
      updateWikiGeneral: async (): Promise<DiagramGenerationStatus> => {
        updateCalls += 1;
        return { state: "generating", error: null };
      },
    });
    await screen.findByTestId("wiki-general-update");

    fireEvent.click(screen.getByTestId("wiki-general-update"));

    await waitFor(() => expect(updateCalls).toBe(1));
    expect(await screen.findByTestId("wiki-general-stop")).toBeInTheDocument();
  });

  it("shows the generating UI, not the stale banner, while an update run is in flight", async () => {
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "generating",
        error: null,
        has_wiki_general: true,
        stale: true,
        empty: false,
      }),
    });

    expect(await screen.findByTestId("wiki-general-notice")).toHaveTextContent(
      "Building the architecture map",
    );
    expect(screen.queryByTestId("wiki-general-update")).toBeNull();
  });

  it("marks Generate aria-disabled, but keyboard-reachable, when no provider CLI is available", async () => {
    useGroupAvailability.mockReturnValue(false);
    renderNotice();

    const button = await screen.findByTestId("wiki-general-generate");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
  });

  it("ignores a click on Generate when no provider CLI is available", async () => {
    useGroupAvailability.mockReturnValue(false);
    let generateCalls = 0;
    renderNotice({
      generateDiagram: async (): Promise<DiagramGenerationStatus> => {
        generateCalls += 1;
        return { state: "generating", error: null };
      },
    });

    fireEvent.click(await screen.findByTestId("wiki-general-generate"));

    expect(generateCalls).toBe(0);
  });

  it("marks Update aria-disabled, but keyboard-reachable, when no provider CLI is available", async () => {
    useGroupAvailability.mockReturnValue(false);
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "idle",
        error: null,
        has_wiki_general: true,
        stale: true,
        empty: false,
      }),
    });

    const button = await screen.findByTestId("wiki-general-update");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
  });

  it("ignores a click on Update when no provider CLI is available", async () => {
    useGroupAvailability.mockReturnValue(false);
    let updateCalls = 0;
    renderNotice({
      getWikiGeneralStatus: async () => ({
        state: "idle",
        error: null,
        has_wiki_general: true,
        stale: true,
        empty: false,
      }),
      updateWikiGeneral: async (): Promise<DiagramGenerationStatus> => {
        updateCalls += 1;
        return { state: "generating", error: null };
      },
    });

    fireEvent.click(await screen.findByTestId("wiki-general-update"));

    expect(updateCalls).toBe(0);
  });
});
