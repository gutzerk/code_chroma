import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AllWorkflows, copyId, stepChipMode } from "./AllWorkflows";
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
  const actions = { createWorkflow: vi.fn(), updateWorkflow: vi.fn(), deleteWorkflow: vi.fn() } as unknown as WorkflowActions;
  const props = { onBack: vi.fn(), onNew: vi.fn(), onEdit: vi.fn(), onRun: vi.fn() };
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

    const row = screen.getByTestId("all-row-ship");

    expect(screen.getByRole("heading", { name: "All workflows · 2" })).toBeInTheDocument();
    const chips = within(row).getAllByRole("listitem");
    expect(chips.map((c) => c.getAttribute("data-mode"))).toEqual(["new", "handoff", "continue", "you"]);
    expect(row).toHaveTextContent("Ticket");
    expect(row).toHaveTextContent("Done · run7");
    expect(screen.getByTestId("all-row-docs")).toHaveTextContent("Never run");
  });

  it("filters rows by name or step slug", () => {
    setup();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search workflows" }), { target: { value: "WRITE" } });

    expect(screen.queryByTestId("all-row-ship")).toBeNull();
    expect(screen.getByTestId("all-row-docs")).toBeInTheDocument();
  });

  it("says so when nothing matches the search", () => {
    setup();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search workflows" }), { target: { value: "zzz" } });

    expect(screen.getByText("No workflow matches the search.")).toBeInTheDocument();
  });

  it("duplicates a workflow under a new id and a copy name", () => {
    const { actions } = setup();

    openMenu("Ship a feature");
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    expect(actions.createWorkflow).toHaveBeenCalledWith({ ...ship, id: "ship-copy", name: "Ship a feature copy" });
  });

  it("renames a workflow through the update", () => {
    const { actions } = setup();

    openMenu("Write docs");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "  Docs pass " } });
    fireEvent.click(screen.getByTestId("rename-save"));

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

  it("wires Edit, Run, New workflow and Back to the callers", () => {
    const { onBack, onNew, onEdit, onRun } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Edit workflow Write docs" }));
    fireEvent.click(screen.getByRole("button", { name: "Start run: Write docs" }));
    fireEvent.click(screen.getByTestId("new-workflow"));
    fireEvent.click(screen.getByRole("button", { name: "Back to runs" }));

    expect(onEdit).toHaveBeenCalledWith(docs);
    expect(onRun).toHaveBeenCalledWith(docs);
    expect(onNew).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });
});

describe("AllWorkflows helpers", () => {
  it.each([
    [[], "ship-copy"],
    [["ship-copy"], "ship-copy-2"],
    [["ship-copy", "ship-copy-2"], "ship-copy-3"],
  ])("picks a free copy id when %j are taken", (taken, expected) => {
    expect(copyId("ship", taken)).toBe(expected);
  });

  it("reads a step without an agent mode as hand-off", () => {
    expect(stepChipMode({ id: "x", slug: "x", kind: "agent", prompt: "" })).toBe("handoff");
  });
});
