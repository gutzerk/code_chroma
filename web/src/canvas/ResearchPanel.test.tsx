import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ResearchPanel } from "./ResearchPanel";
import { inspectorStore } from "./inspectorStore";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import {
  IMPACT_CHANGES_STUB,
  EPICS_STUB,
  PATTERNS_STUB,
  RESEARCH_STUB, EPIC_BRIEF_STUB,
  diagramStub,
} from "../engine-client/stubEngineClient";
import type { EngineClient } from "../engine-client/EngineClient";
import type { Diagram, ResearchJobState } from "../state/types";

const EMPTY_C1: Diagram = { nodes: [], relations: [] };

function client(overrides: Partial<EngineClient> = {}): EngineClient {
  return {
    ...IMPACT_CHANGES_STUB,
    ...EPICS_STUB,
    ...PATTERNS_STUB,
    ...RESEARCH_STUB,
    ...EPIC_BRIEF_STUB,
    getNode: async () => null,
    getChildren: async () => [],
    getConnections: async () => [],
    getDiff: async () => [],
    acceptDiff: async () => {},
    getDiagram: diagramStub({ c1: EMPTY_C1 }),
    getDiagramLayout: async () => ({}),
    saveDiagramLayout: async () => {},
    generateDiagram: async () => ({ state: "idle" as const, error: null }),
    getDiagramStatus: async () => ({ state: "idle" as const, error: null }),
    listTraces: async () => [],
    getTrace: async () => ({ id: "", entry: "", created_at: "", status: "ok" as const, steps: [] }),
    subscribe: () => () => {},
    subscribeDiagram: () => () => {},
    subscribeDiagramStatus: () => () => {},
    subscribeTrace: () => () => {},
    subscribeTraceStream: () => () => {},
    ...overrides,
  };
}

function renderPanel(engineClient: EngineClient = client()) {
  return render(
    <EngineClientProvider repoId="default" client={engineClient}>
      <ResearchPanel />
    </EngineClientProvider>,
  );
}

const DONE_WITH_CITATION: ResearchJobState = {
  job_key: "main:abc",
  state: "done",
  error: null,
  answer: {
    query: "where is the discount applied",
    answer: "The discount is applied in apply_discount [1].",
    citations: [{ node_id: "function::apply_discount", path: "billing/service.py", symbol: "apply_discount" }],
    degraded: false,
    generated_at: "2026-01-01T00:00:00Z",
  },
};

const DONE_DEGRADED_NO_MATCH: ResearchJobState = {
  job_key: "main:def",
  state: "done",
  error: null,
  answer: {
    query: "nonsense",
    answer: "No relevant match was found for this question in the analyzed repository.",
    citations: [],
    degraded: true,
    generated_at: "2026-01-01T00:00:00Z",
  },
};

describe("ResearchPanel", () => {
  it("asking a question renders the answer and its citations", async () => {
    renderPanel(client({ askResearch: async () => DONE_WITH_CITATION }));

    fireEvent.change(screen.getByTestId("research-panel-input"), {
      target: { value: "where is the discount applied" },
    });
    fireEvent.click(screen.getByTestId("research-panel-ask"));

    await waitFor(() =>
      expect(screen.getByTestId("research-panel-answer")).toHaveTextContent("apply_discount"),
    );
    expect(screen.getByTestId("research-panel-citation-0")).toHaveTextContent("apply_discount");
  });

  it("clicking a citation opens the Inspector on that exact node", async () => {
    const openSpy = vi.spyOn(inspectorStore, "open");
    renderPanel(client({ askResearch: async () => DONE_WITH_CITATION }));
    fireEvent.change(screen.getByTestId("research-panel-input"), { target: { value: "q" } });
    fireEvent.click(screen.getByTestId("research-panel-ask"));
    await waitFor(() => screen.getByTestId("research-panel-citation-0"));

    fireEvent.click(screen.getByTestId("research-panel-citation-0"));

    expect(openSpy).toHaveBeenCalledWith("function::apply_discount", "apply_discount");
    openSpy.mockRestore();
  });

  it("a degraded answer shows the keyword-match badge", async () => {
    renderPanel(client({ askResearch: async () => DONE_DEGRADED_NO_MATCH }));
    fireEvent.change(screen.getByTestId("research-panel-input"), { target: { value: "nonsense" } });

    fireEvent.click(screen.getByTestId("research-panel-ask"));

    await waitFor(() => expect(screen.getByTestId("research-panel-degraded-badge")).toBeInTheDocument());
  });

  it("no citations renders the no-match message instead of an empty citation list", async () => {
    renderPanel(client({ askResearch: async () => DONE_DEGRADED_NO_MATCH }));
    fireEvent.change(screen.getByTestId("research-panel-input"), { target: { value: "nonsense" } });

    fireEvent.click(screen.getByTestId("research-panel-ask"));

    await waitFor(() =>
      expect(screen.getByTestId("research-panel-no-match")).toHaveTextContent("No relevant match"),
    );
  });

  it("submitting a blank question does not call askResearch", () => {
    const askResearch = vi.fn(async () => DONE_WITH_CITATION);
    renderPanel(client({ askResearch }));

    fireEvent.click(screen.getByTestId("research-panel-ask"));

    expect(askResearch).not.toHaveBeenCalled();
  });
});
