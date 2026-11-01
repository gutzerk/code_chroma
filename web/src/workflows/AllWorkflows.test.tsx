import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AllWorkflows } from "./AllWorkflows";
import type { Run, WorkflowDef } from "./types";
import type { WorkflowActions } from "./workflowStore";

const ship: WorkflowDef = {
  id: "ship",
  name: "Ship a feature",
  steps: [
    { id: "plan", slug: "plan", kind: "agent", prompt: "Plan", agent: "new", input: { name: "ticket", label: "Ticket" } },
    { id: "build", slug: "build", kind: "agent", prompt: "Build", agent: "handoff" },
    { id: "fix", slug: "fix", kind: "agent", prompt: "Fix", agent: "continue:plan" },
    { id: "check", slug: "check", kind: "review", prompt: "" },
  ],
};
const docs: WorkflowDef = { id: "docs", name: "Write docs", steps: [{ id: "a", slug: "write", kind: "agent", prompt: "Write" }] };

const run: Run = {
  id: "run7",
  workflowId: "ship",
  state: "done",
  currentStepId: null,
  stopAfter: null,
  attempt: 1,
  attempts: [],
  breakpoints: [],
  steps: [],
};

function setup(workflows: WorkflowDef[] = [ship, docs]) {
  const actions = { duplicateWorkflow: vi.fn(), updateWorkflow: vi.fn(), deleteWorkflow: vi.fn() } as unknown as WorkflowActions;
  const props = { onBack: vi.fn(), onEdit: vi.fn(), onRun: vi.fn() };
  render(<AllWorkflows workflows={workflows} runs={[run]} actions={actions} {...props} />);
  return { actions, ...props };
}

function openMenu(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `More actions for ${name}` }));
}

describe("AllWorkflows", () => {
  afterEach(cleanup);

  it("shows one row per workflow with mode chips, inputs and the last run", () => {
    setup();

    const row = screen.getByTestId("saved-ship");

    expect(screen.getByRole("heading", { name: /All workflows/ })).toHaveTextContent("· 2");
    const chips = row.querySelectorAll(".wf-chip");
    expect([...chips].map((c) => c.getAttribute("data-mode"))).toEqual(["new", "hand-off", "continue", "you"]);
    expect(row).toHaveTextContent("Ticket");
    expect(row).toHaveTextContent("Done");
    expect(screen.getByTestId("saved-docs")).toHaveTextContent("Never run");
  });

  it("filters rows by name", () => {
    setup();

    fireEvent.change(screen.getByPlaceholderText("Search workflows"), { target: { value: "WRITE" } });

    expect(screen.queryByTestId("saved-ship")).toBeNull();
    expect(screen.getByTestId("saved-docs")).toBeInTheDocument();
  });

  it("says so when nothing matches the search", () => {
    setup();

    fireEvent.change(screen.getByPlaceholderText("Search workflows"), { target: { value: "zzz" } });

    expect(screen.getByText("No workflow matches the search.")).toBeInTheDocument();
  });

  it("duplicates a workflow from the actions menu", () => {
    const { actions } = setup();

    openMenu("Ship a feature");
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    expect(actions.duplicateWorkflow).toHaveBeenCalledWith(ship);
  });

  it("renames a workflow through the update", () => {
    const { actions } = setup();

    openMenu("Write docs");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "  Docs pass " } });
    fireEvent.click(within(screen.getByTestId("rename-dialog")).getByRole("button", { name: "Rename" }));

    expect(actions.updateWorkflow).toHaveBeenCalledWith({ ...docs, name: "Docs pass" });
    expect(screen.queryByTestId("rename-dialog")).toBeNull();
  });

  it("deletes a workflow only after confirming", () => {
    const { actions } = setup();

    openMenu("Write docs");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(actions.deleteWorkflow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-yes"));

    expect(actions.deleteWorkflow).toHaveBeenCalledWith("docs");
  });

  it("wires Edit, Run and Back to the callers", () => {
    const { onBack, onEdit, onRun } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Edit workflow Write docs" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Write docs" }));
    fireEvent.click(screen.getByTestId("all-back"));

    expect(onEdit).toHaveBeenCalledWith(docs);
    expect(onRun).toHaveBeenCalledWith(docs);
    expect(onBack).toHaveBeenCalled();
  });
});
