import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EngineClient } from "../engine-client/EngineClient";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { WorkflowEditorDialog, deriveInputName, validateDraft, type StepDraft } from "./WorkflowEditorDialog";
import { workflowStore } from "./workflowStore";
import type { Run, WorkflowDef } from "./types";

function fakeClient() {
  return {
    listSkills: vi.fn(async () => [{ name: "review-skill", description: "d" }]),
    listWorkflows: vi.fn(async () => [] as WorkflowDef[]),
    createWorkflow: vi.fn(async (w: WorkflowDef) => w),
    updateWorkflow: vi.fn(async (w: WorkflowDef) => w),
    startRun: vi.fn(async () => ({ id: "r1" }) as Run),
  };
}

function open(client: ReturnType<typeof fakeClient>, props: Parameters<typeof WorkflowEditorDialog>[0]) {
  return render(
    <EngineClientProvider repoId="default" client={client as unknown as EngineClient}>
      <WorkflowEditorDialog {...props} />
    </EngineClientProvider>,
  );
}

const existing: WorkflowDef = {
  id: "wf-1",
  name: "Ship",
  steps: [
    { id: "a", slug: "Plan", kind: "agent", prompt: "plan it", agent: "new" },
    { id: "b", slug: "Build", kind: "agent", prompt: "build it", agent: "handoff" },
    { id: "c", slug: "Check", kind: "review", prompt: "" },
  ],
};

const draft = (over: Partial<StepDraft>): StepDraft => ({
  id: "x", slug: "t", kind: "agent", prompt: "p", skill: "", ...over,
});

describe("validateDraft", () => {
  it("requires a name and instructions on agent steps", () => {
    const errors = validateDraft(" ", [draft({ prompt: "" }), draft({ kind: "review", prompt: "" })]);

    expect(errors.name).toBeDefined();
    expect(errors.steps?.[0]).toMatch(/instructions/);
    expect(errors.steps?.[1]).toBeUndefined();
  });
});

describe("WorkflowEditorDialog", () => {
  beforeEach(() => workflowStore.reset());
  afterEach(cleanup);

  it("creates a workflow with a fresh id", async () => {
    const client = fakeClient();
    const onClose = vi.fn();
    open(client, { onClose });

    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "My flow" } });
    fireEvent.change(screen.getByLabelText(/^Instructions/), { target: { value: "do {{pr}}" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const saved = client.createWorkflow.mock.calls[0][0];
    expect(saved.id).toMatch(/^workflow-/);
    expect(saved.name).toBe("My flow");
    expect(saved.steps[0].agent).toBe("new");
  });

  it("edits an existing workflow, keeps the id and warns when a run uses it", async () => {
    const client = fakeClient();
    const onClose = vi.fn();
    workflowStore.setRuns([{ id: "r", workflowId: "wf-1", state: "running" } as Run]);
    open(client, { workflow: existing, onClose });

    expect(screen.getByText(/A run is using this workflow/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "Ship 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.updateWorkflow.mock.calls[0][0]).toMatchObject({ id: "wf-1", name: "Ship 2" });
    expect(client.createWorkflow).not.toHaveBeenCalled();
  });

  it("shows no banner when the only run is finished", () => {
    workflowStore.setRuns([{ id: "r", workflowId: "wf-1", state: "done" } as Run]);
    open(fakeClient(), { workflow: existing, onClose: vi.fn() });

    expect(screen.queryByText(/A run is using this workflow/)).toBeNull();
  });

  it("gives a review step no instructions field and limits send-back to earlier agent steps", () => {
    open(fakeClient(), { workflow: existing, onClose: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Step 3: Check" }));

    expect(screen.queryByLabelText(/^Instructions/)).toBeNull();
    expect(screen.getByLabelText("Show the diff")).toBeInTheDocument();
    expect(screen.getByLabelText(/Show the previous agent/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Step 1: Plan" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Step 2: Build" })).toBeInTheDocument();
    expect(screen.getByTestId("between-2")).toHaveTextContent("You review the diff");
    expect(screen.getByTestId("between-1")).toHaveTextContent("Passes output to step 2");
  });

  it("blocks saving an agent step without instructions", async () => {
    const client = fakeClient();
    open(client, { onClose: vi.fn() });

    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/Fill in the instructions/)).toBeInTheDocument();
    expect(client.createWorkflow).not.toHaveBeenCalled();
  });

  it("moves and deletes steps", async () => {
    open(fakeClient(), { workflow: existing, onClose: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Move down" }));
    const order = () => screen.getAllByRole("button", { name: /^Step \d:/ }).map((b) => b.getAttribute("aria-label"));
    expect(order()).toEqual(["Step 1: Build", "Step 2: Plan", "Step 3: Check"]);

    fireEvent.click(screen.getByRole("button", { name: "Delete step" }));
    await act(async () => {});
    expect(order()).toEqual(["Step 1: Build", "Step 2: Check"]);
  });

  it("saves and runs a workflow without inputs", async () => {
    const client = fakeClient();
    client.listWorkflows.mockResolvedValue([existing]);
    const onClose = vi.fn();
    open(client, { workflow: existing, onClose });

    fireEvent.click(screen.getByRole("button", { name: "Save and run" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.startRun).toHaveBeenCalledWith("wf-1", undefined);
  });

  it("gives each agent step one input field, derives its name and saves it on the step", async () => {
    const client = fakeClient();
    open(client, { onClose: vi.fn() });

    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "Review" } });
    fireEvent.change(screen.getByLabelText(/^Instructions/), { target: { value: "Review the PR" } });
    fireEvent.change(screen.getByLabelText(/^Ask for input/), { target: { value: "Which PR?" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(client.createWorkflow).toHaveBeenCalled());
    const saved = client.createWorkflow.mock.calls[0][0];
    expect(screen.queryByText("Run inputs")).toBeNull();
    expect(saved.inputs).toEqual([]);
    expect(saved.steps[0].input).toEqual({ name: "Which-PR", label: "Which PR?" });
    expect(saved.steps[0].prompt).toBe("Review the PR {{Which-PR}}");
  });

  it("binds an older workflow-level input to the step that mentions it", async () => {
    const client = fakeClient();
    const legacy: WorkflowDef = {
      ...existing,
      inputs: [{ name: "pr", label: "PR number" }],
      steps: existing.steps.map((st) => (st.id === "b" ? { ...st, prompt: "build {{pr}}" } : st)),
    };
    open(client, { workflow: legacy, onClose: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Step 2: Build" }));

    expect((screen.getByLabelText(/^Ask for input/) as HTMLInputElement).value).toBe("PR number");
  });
});

describe("deriveInputName", () => {
  it("makes a valid unique identifier from a question", () => {
    const name = deriveInputName("  1st: which PR?? ", ["st-which-PR"]);

    expect(name).toBe("st-which-PR-2");
  });
});
