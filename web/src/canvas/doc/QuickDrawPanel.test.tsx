import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EngineClient } from "../../engine-client/EngineClient";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { IMPACT_CHANGES_STUB } from "../../engine-client/stubEngineClient";
import { QuickDrawPanel } from "./QuickDrawPanel";

const TYPES = [{ id: "process", title: "Process", description: "", style: "boxes-arrows" }];

function renderPanel(client: Partial<EngineClient>) {
  render(
    <EngineClientProvider repoId="main" client={{ ...IMPACT_CHANGES_STUB, listDiagramTypes: async () => TYPES, ...client } as EngineClient}>
      <QuickDrawPanel onClose={vi.fn()} />
    </EngineClientProvider>,
  );
}

afterEach(cleanup);

describe("QuickDrawPanel", () => {
  it("starts a run for the chosen type with the typed request", async () => {
    const generateProcessDiagram = vi.fn(async () => ({ state: "generating" as const }));
    renderPanel({ generateProcessDiagram });
    await screen.findByRole("option", { name: "Process" });

    fireEvent.change(screen.getByLabelText("What to draw"), { target: { value: "  how login works " } });
    fireEvent.click(screen.getByTestId("quick-draw-run"));

    await waitFor(() => expect(generateProcessDiagram).toHaveBeenCalledWith("process", "how login works"));
  });

  it("shows the bridge's reason when the run can't start", async () => {
    renderPanel({ generateProcessDiagram: async () => ({ state: "error" as const, error: "generate the architecture map first" }) });
    await screen.findByRole("option", { name: "Process" });

    fireEvent.change(screen.getByLabelText("What to draw"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("quick-draw-run"));

    expect(await screen.findByTestId("quick-draw-error")).toHaveTextContent("generate the architecture map first");
  });

  it("asks for a saved type when the library is empty", async () => {
    renderPanel({ listDiagramTypes: async () => [] });

    expect(await screen.findByText(/Save a custom diagram type first/)).toBeInTheDocument();
  });
});
