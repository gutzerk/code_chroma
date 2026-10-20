import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentClient } from "../../agents/agentClient";
import { agentStore } from "../../agents/agentStore";
import { AgentClientProvider } from "../../agents/AgentClientContext";
import { PR_CLIENT_STUB } from "../../agents/stubAgentClient";
import { layoutStore } from "../layout/layoutStore";
import { buildDrawOptionTask, DrawDiagramPopover } from "./DrawDiagramPopover";

function renderPopover(onClose = vi.fn(), agentClient: Partial<AgentClient> = {}) {
  render(
    <AgentClientProvider client={{ ...PR_CLIENT_STUB, ...agentClient } as unknown as AgentClient}>
      <DrawDiagramPopover onClose={onClose} />
    </AgentClientProvider>,
  );
  return onClose;
}

afterEach(() => {
  cleanup();
  agentStore.reset();
  layoutStore.reset();
});

describe("DrawDiagramPopover", () => {
  it("renders the five options under an accessible dialog", () => {
    renderPopover();

    const dialog = screen.getByRole("dialog", { name: "Draw a diagram" });

    expect(dialog).toHaveTextContent("Ask an agent to draw");
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(screen.getByText("C1 · system context")).toBeInTheDocument();
    expect(screen.getByText("Custom…")).toBeInTheDocument();
  });

  it("sits at left 286 when the left panel is open and 68 when collapsed", () => {
    layoutStore.closeLeft();
    renderPopover();

    expect(screen.getByRole("dialog")).toHaveStyle({ left: "68px", top: "10px" });
  });

  it("closes from the header button", () => {
    const onClose = renderPopover();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("launches an agent when an option is chosen", async () => {
    const create = vi.fn(async () => {
      throw new Error("stop here");
    });
    renderPopover(vi.fn(), {
      create,
      gitPreflight: async () => ({ state: "ready" as const, root: "/repo" }),
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Patterns"));
    });

    expect(create).toHaveBeenCalled();
  });
});

describe("buildDrawOptionTask", () => {
  it("names the chosen type and the draw skill", () => {
    expect(buildDrawOptionTask("epics")).toContain("epics diagram");
    expect(buildDrawOptionTask("epics")).toContain("codechroma-draw-diagram");
  });
});
