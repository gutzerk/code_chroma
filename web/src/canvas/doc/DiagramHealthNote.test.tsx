import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DiagramHealthNote } from "./DiagramHealthNote";
import { diagramHealthStore } from "../../state/diagramHealthStore";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import type { EngineClient } from "../../engine-client/EngineClient";
import { IMPACT_CHANGES_STUB } from "../../engine-client/stubEngineClient";
import type { DiagramDiagnostics, DiagramDrop } from "../../state/types";

function diagnosticsOf(dropped: DiagramDrop[], total = dropped.length): DiagramDiagnostics {
  return { dropped, dropped_count: total, shown: dropped.length, truncated: total > dropped.length };
}

function renderNote(overrides: Partial<EngineClient> = {}) {
  const client = { ...IMPACT_CHANGES_STUB, ...overrides } as unknown as EngineClient;
  return render(
    <EngineClientProvider repoId="default" client={client}>
      <DiagramHealthNote />
    </EngineClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  diagramHealthStore.reset();
});

describe("DiagramHealthNote", () => {
  it("stays silent when every diagram drew in full", () => {
    renderNote();

    expect(screen.queryByTestId("diagram-health-note")).toBeNull();
  });

  it("stays silent for a run that reported a zero drop count", () => {
    diagramHealthStore.set("impact", diagnosticsOf([]));

    renderNote();

    expect(screen.queryByTestId("diagram-health-note")).toBeNull();
  });

  it("names the layer, the count and the reasons a part was not drawn", () => {
    // 🔴 The whole point: this loss used to be completely invisible, on a canvas that looked fine.
    diagramHealthStore.set(
      "patterns",
      diagnosticsOf([
        { what: "node", id: "a", reason: "invalid_shape" },
        { what: "relation", id: "a -> b", reason: "dangling_endpoint" },
      ]),
    );

    renderNote();

    const row = screen.getByTestId("diagram-health-patterns");
    expect(row).toHaveTextContent("patterns");
    expect(row).toHaveTextContent("2 parts not drawn");
    expect(row).toHaveTextContent("points at a box that isn't there");
  });

  it("reports the true total when the reported list was capped below it", () => {
    diagramHealthStore.set("c1", diagnosticsOf([{ what: "node", id: "a", reason: "depth_capped" }], 40));

    renderNote();

    expect(screen.getByTestId("diagram-health-c1")).toHaveTextContent("40 parts not drawn");
  });

  it("can be dismissed for one layer without hiding another's", () => {
    diagramHealthStore.set("c1", diagnosticsOf([{ what: "node", id: "a", reason: "invalid_shape" }]));
    diagramHealthStore.set("impact", diagnosticsOf([{ what: "node", id: "b", reason: "invalid_shape" }]));
    renderNote();

    fireEvent.click(screen.getByTestId("diagram-health-dismiss-c1"));

    expect(screen.queryByTestId("diagram-health-c1")).toBeNull();
    expect(screen.getByTestId("diagram-health-impact")).toBeInTheDocument();
  });

  it("surfaces a failed generation's error, which no component rendered before", () => {
    renderNote({
      getDiagramStatus: async () => ({ state: "error" as const, error: "claude exited 1" }),
    });

    return screen.findByTestId("diagram-health-error").then((node) => {
      expect(node).toHaveTextContent("claude exited 1");
    });
  });
});
