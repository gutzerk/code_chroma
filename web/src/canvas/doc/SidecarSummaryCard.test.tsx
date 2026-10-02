import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SidecarSummaryCard } from "./SidecarSummaryCard";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { C1Coverage, DiagramGenerationStatus } from "../../state/types";
import { IMPACT_CHANGES_STUB, EMPTY_C1_COVERAGE } from "../../engine-client/stubEngineClient";

const PARTIAL: C1Coverage = {
  has_diagram: true,
  total_files: 418,
  covered_files: 312,
  unmapped_files: 106,
  percent: 74,
  entries: [],
  truncated: false,
};

function renderCoverage(coverage: C1Coverage, status: DiagramGenerationStatus = { state: "idle", error: null }) {
  const client = {
    ...IMPACT_CHANGES_STUB,
    getSidecar: async () => coverage,
    getDiagramStatus: async () => status,
    subscribe: () => () => {},
  } as unknown as EngineClient;
  render(
    <EngineClientProvider repoId="default" client={client}>
      <SidecarSummaryCard />
    </EngineClientProvider>,
  );
}

/** The one place a curated C1 diagram admits it is curated. Silent whenever saying it would
 * mislead: before a diagram exists, while a run is rewriting it, and when nothing is left over. */
describe("SidecarSummaryCard", () => {
  it("reports the file counts when some code sits outside every named block", async () => {
    renderCoverage(PARTIAL);

    const note = await screen.findByTestId("c1-coverage-note");

    expect(note.textContent).toContain("312 of 418 files");
    expect(note.textContent).toContain("106 in Unmapped code");
  });

  it("announces itself, since it appears asynchronously after the canvas has settled", async () => {
    renderCoverage(PARTIAL);

    const note = await screen.findByTestId("c1-coverage-note");

    expect(note).toHaveAttribute("role", "status");
  });

  it("stays silent when every file is covered", async () => {
    renderCoverage({ ...PARTIAL, covered_files: 418, unmapped_files: 0, percent: 100 });

    await waitFor(() => expect(screen.queryByTestId("c1-coverage-note")).not.toBeInTheDocument());
  });

  it("stays silent before a diagram exists, where 0% means 'none drawn' not 'none covered'", async () => {
    renderCoverage({ ...EMPTY_C1_COVERAGE, total_files: 418, unmapped_files: 418, percent: 0 });

    await waitFor(() => expect(screen.queryByTestId("c1-coverage-note")).not.toBeInTheDocument());
  });

  it("stays silent while a run is rewriting the blocks these counts describe", async () => {
    renderCoverage(PARTIAL, { state: "generating", error: null });

    await waitFor(() => expect(screen.queryByTestId("c1-coverage-note")).not.toBeInTheDocument());
  });
});
