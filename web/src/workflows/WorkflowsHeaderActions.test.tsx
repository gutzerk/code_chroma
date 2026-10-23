import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { layoutStore } from "../canvas/layout/layoutStore";
import { WorkflowsHeaderActions } from "./WorkflowsHeaderActions";
import { workflowStore } from "./workflowStore";

beforeEach(() => {
  layoutStore.reset();
  workflowStore.reset();
});
afterEach(cleanup);

describe("WorkflowsHeaderActions", () => {
  it("opens the run dialog and the All workflows screen from the runs view", () => {
    render(<WorkflowsHeaderActions agentsMode="normal" />);

    fireEvent.click(screen.getByRole("button", { name: "Run workflow" }));
    expect(workflowStore.getDialog()).toEqual({ kind: "run" });
    fireEvent.click(screen.getByRole("button", { name: "All workflows" }));

    expect(workflowStore.getView()).toBe("all");
  });

  it("swaps Run workflow for New workflow on the All workflows screen", () => {
    workflowStore.setView("all");
    render(<WorkflowsHeaderActions agentsMode="normal" />);

    expect(screen.queryByRole("button", { name: "Run workflow" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /New workflow/ }));

    expect(workflowStore.getDialog()).toEqual({ kind: "editor" });
  });

  it("goes full screen and collapses the panel", () => {
    render(<WorkflowsHeaderActions agentsMode="normal" />);

    expect(screen.queryByRole("button", { name: "Stretch panel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(layoutStore.getState().agentsMode).toBe("full");
    act(() => layoutStore.setAgentsMode("normal"));
    fireEvent.click(screen.getByRole("button", { name: "Collapse agents and workflows" }));

    expect(layoutStore.getState().agentsMode).toBe("collapsed");
  });

  it("offers Exit full screen instead of full screen and collapse while full", () => {
    layoutStore.setAgentsMode("full");
    render(<WorkflowsHeaderActions agentsMode="full" />);

    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Collapse agents and workflows" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));

    expect(layoutStore.getState().agentsMode).toBe("normal");
  });
});
