import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { EngineClient } from "../engine-client/EngineClient";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import type { Provider } from "../llm-settings/llmSettingsClient";
import { WorkflowEditorDialog, deriveInputName, validateDraft, type StepDraft } from "./WorkflowEditorDialog";
import { workflowStore } from "./workflowStore";
import type { Run, WorkflowDef } from "./types";

const llm = vi.hoisted(() => ({
  listProviders: vi.fn(),
  fetchProviderModels: vi.fn(),
}));
vi.mock("../llm-settings/llmSettingsClient", () => llm);

const provider = (id: string, adapter: string): Provider =>
  ({ id, label: id, kind: "cli", adapter }) as Provider;

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
  beforeEach(() => {
    workflowStore.reset();
    llm.listProviders.mockResolvedValue([provider("claude", "claude"), provider("codex", "codex")]);
    llm.fetchProviderModels.mockResolvedValue({ supported: true, models: [{ id: "sonnet", label: null }, { id: "opus", label: null }] });
  });
  afterEach(cleanup);

  it("creates a workflow with a fresh id", async () => {
    const client = fakeClient();
    const onClose = vi.fn();
    open(client, { onClose });

    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "My flow" } });
    fireEvent.change(screen.getByLabelText(/^Instructions/), { target: { value: "do {{pr}}" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save( changes)?$/ }));

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

    expect(screen.getByText(/1 run is using this workflow now/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "Ship 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.updateWorkflow.mock.calls[0][0]).toMatchObject({ id: "wf-1", name: "Ship 2" });
    expect(client.createWorkflow).not.toHaveBeenCalled();
  });

  it("shows no banner when the only run is finished", () => {
    workflowStore.setRuns([{ id: "r", workflowId: "wf-1", state: "done" } as Run]);
    open(fakeClient(), { workflow: existing, onClose: vi.fn() });

    expect(screen.queryByText(/is using this workflow/)).toBeNull();
  });

  it("gives a review step no instructions field and limits send-back to earlier agent steps", () => {
    open(fakeClient(), { workflow: existing, onClose: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Step 3: Check" }));

    expect(screen.queryByLabelText(/^Instructions/)).toBeNull();
    expect(screen.getByLabelText("Changes made by step 2 (diff on the canvas)")).toBeInTheDocument();
    expect(screen.getByLabelText("Step 2 agent's summary")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Step 1 · Plan" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Step 2 · Build" })).toBeInTheDocument();
    expect(screen.getByTestId("between-2")).toHaveTextContent("diff → you");
    expect(screen.getByTestId("between-1")).toHaveTextContent("hand-off → step 2");
  });

  it("blocks saving an agent step without instructions", async () => {
    const client = fakeClient();
    open(client, { onClose: vi.fn() });

    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save( changes)?$/ }));

    expect(await screen.findByText(/Fill in the instructions/)).toBeInTheDocument();
    expect(client.createWorkflow).not.toHaveBeenCalled();
  });

  it("moves and deletes steps", async () => {
    open(fakeClient(), { workflow: existing, onClose: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Move step down" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.updateWorkflow).toHaveBeenCalled();
  });

  it("saves and runs a new workflow", async () => {
    const client = fakeClient();
    client.listWorkflows.mockResolvedValue([existing]);
    const onClose = vi.fn();
    open(client, { onClose });
    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "Quick" } });
    fireEvent.change(screen.getByLabelText(/^Instructions/), { target: { value: "go" } });

    fireEvent.click(screen.getByRole("button", { name: "Save and run" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.startRun).toHaveBeenCalled();
  });
});

describe("WorkflowEditorDialog nested dialogs", () => {
  beforeEach(() => workflowStore.reset());
  afterEach(cleanup);

  it("Escape on the delete confirm closes only the confirm, not the editor", () => {
    const onClose = vi.fn();
    open(fakeClient(), { workflow: existing, onClose });
    fireEvent.click(screen.getByRole("button", { name: "Delete workflow" }));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Workflow editor" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("WorkflowEditorDialog design details", () => {
  beforeEach(() => workflowStore.reset());
  afterEach(cleanup);

  it("shows the step count line, per-step mode and the footer summary", () => {
    open(fakeClient(), { workflow: existing, onClose: vi.fn() });

    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("Agent · default · new + hand-off")).toBeInTheDocument();
    expect(screen.getByText("Your step")).toBeInTheDocument();
    expect(screen.getByText("3 steps · 2 agent · 1 you")).toBeInTheDocument();
  });

  it("flags unsaved changes when editing", () => {
    open(fakeClient(), { workflow: existing, onClose: vi.fn() });

    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "Ship 2" } });

    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("deletes the workflow after confirming", async () => {
    const client = { ...fakeClient(), deleteWorkflow: vi.fn(async () => {}) };
    const onClose = vi.fn();
    open(client as ReturnType<typeof fakeClient>, { workflow: existing, onClose });

    fireEvent.click(screen.getByRole("button", { name: "Delete workflow" }));
    fireEvent.click(screen.getByTestId("confirm-yes"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.deleteWorkflow).toHaveBeenCalledWith("wf-1");
  });

  it("gives each agent step one input field, derives its name and saves it on the step", async () => {
    const client = fakeClient();
    open(client, { onClose: vi.fn() });

    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "Review" } });
    fireEvent.change(screen.getByLabelText(/^Instructions/), { target: { value: "Review the PR" } });
    fireEvent.change(screen.getByLabelText(/^Ask for input/), { target: { value: "Which PR?" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: /^Save( changes)?$/ }));

    await waitFor(() => expect(client.createWorkflow).toHaveBeenCalled());
    const saved = client.createWorkflow.mock.calls[0][0];
    expect(screen.queryByText("Run inputs")).toBeNull();
    expect(saved.inputs).toEqual([]);
    expect(saved.steps[0].input).toEqual({ name: "Which-PR", label: "Which PR?" });
    expect(saved.steps[0].prompt).toBe("Review the PR {{Which-PR}}");
  });

  it("opens the run dialog after Save and run when the workflow asks for inputs", async () => {
    const client = fakeClient();
    client.listWorkflows.mockResolvedValue([]);
    const onClose = vi.fn();
    open(client, { onClose });
    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "Ask" } });
    fireEvent.change(screen.getByLabelText(/^Instructions/), { target: { value: "Review the PR" } });
    fireEvent.change(screen.getByLabelText(/^Ask for input/), { target: { value: "Which PR?" } });

    fireEvent.click(screen.getByRole("button", { name: "Save and run" }));

    await waitFor(() => expect(workflowStore.getDialog()?.kind).toBe("run"));
    expect(client.startRun).not.toHaveBeenCalled();
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

describe("WorkflowEditorDialog agent sessions", () => {
  beforeEach(() => {
    workflowStore.reset();
    llm.listProviders.mockResolvedValue([provider("claude", "claude"), provider("codex", "codex")]);
    llm.fetchProviderModels.mockResolvedValue({ supported: true, models: [{ id: "sonnet", label: null }, { id: "opus", label: null }] });
  });
  afterEach(cleanup);

  const chain = (over: Partial<WorkflowDef["steps"][number]>[]): WorkflowDef => ({
    id: "wf-2",
    name: "Chain",
    steps: [
      { id: "a", slug: "Plan", kind: "agent", prompt: "plan", agent: "new", ...over[0] },
      { id: "b", slug: "Build", kind: "agent", prompt: "build", agent: "handoff", ...over[1] },
      { id: "c", slug: "Check", kind: "review", prompt: "", ...over[2] },
      { id: "d", slug: "Ship", kind: "agent", prompt: "ship", agent: "continue", ...over[3] },
    ],
  });

  const pick = (n: number, slug: string) => fireEvent.click(screen.getByRole("button", { name: `Step ${n}: ${slug}` }));
  const providersLoaded = () => act(async () => {});

  it("opens an older definition without an agent as hand-off and a fresh context as new", () => {
    const old = chain([{}, { agent: undefined }, {}, { agent: undefined, context: "fresh" } as never]);
    open(fakeClient(), { workflow: old, onClose: vi.fn() });

    pick(2, "Build");

    expect(screen.getByRole("radio", { name: "New + hand-off" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Step 2: Build" })).toHaveTextContent("Agent · default · new + hand-off");
    expect(screen.getByRole("button", { name: "Step 4: Ship" })).toHaveTextContent("Agent · default · new");
  });

  it("lets step 1 only be New", () => {
    open(fakeClient(), { workflow: chain([]), onClose: vi.fn() });

    expect(screen.getByRole("radio", { name: "New" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "New + hand-off" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText("Step 1 can only be New.")).toBeInTheDocument();
  });

  it("switches modes and relabels the rail and the connector", () => {
    open(fakeClient(), { workflow: chain([]), onClose: vi.fn() });
    pick(2, "Build");

    fireEvent.click(screen.getByRole("radio", { name: "Continue" }));
    const continued = [screen.getByTestId("between-1").textContent, screen.getByRole("button", { name: "Step 2: Build" }).textContent];
    fireEvent.click(screen.getByRole("radio", { name: "New" }));

    expect(continued[0]).toBe("resumes step 1's agent");
    expect(continued[1]).toContain("Agent · default · continue: Plan");
    expect(screen.getByTestId("between-1")).toHaveTextContent(/^$/);
    expect(screen.getByRole("button", { name: "Step 2: Build" })).toHaveTextContent("Agent · default · new");
  });

  it("lists only earlier agent steps as continue sources, nearest first", () => {
    open(fakeClient(), { workflow: chain([]), onClose: vi.fn() });

    pick(4, "Ship");
    const options = within(screen.getByLabelText("Continue from")).getAllByRole("option").map((o) => o.textContent);

    expect(options).toEqual(["Nearest earlier · Step 2 · Build", "Step 1 · Plan", "Step 2 · Build"]);
    expect(screen.getByTestId("between-3")).toHaveTextContent("resumes step 2's agent");
  });

  it("turns Continue off with a reason when the step's provider is not claude", async () => {
    open(fakeClient(), { workflow: chain([]), onClose: vi.fn() });
    await providersLoaded();
    pick(2, "Build");

    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "codex" } });

    expect(screen.getByRole("radio", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText("Continue is off. Only claude can resume a session, and this step uses codex.")).toBeInTheDocument();
  });

  it.each([
    ["a provider mismatch", chain([{ provider: "codex" }, {}, {}, { agent: "continue:a", provider: "claude" }]), "Step 1 runs on codex and this step on claude"],
    ["a review step as source", chain([{}, {}, {}, { agent: "continue:c" }]), 'A "You" step has no agent session to continue'],
    [
      "no earlier agent step",
      { id: "w", name: "W", steps: [{ id: "r", slug: "Look", kind: "review", prompt: "" }, { id: "x", slug: "Go", kind: "agent", prompt: "go", agent: "continue" }] } as WorkflowDef,
      "no earlier agent step to continue",
    ],
  ])("blocks save on %s", async (_case, workflow, message) => {
    const client = fakeClient();
    open(client, { workflow, onClose: vi.fn() });
    await providersLoaded();

    fireEvent.click(screen.getByRole("button", { name: /^Save( changes)?$/ }));
    await act(async () => {});

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(client.updateWorkflow).not.toHaveBeenCalled();
  });

  it("only warns when a continue switches model, and still saves", async () => {
    const client = fakeClient();
    const onClose = vi.fn();
    open(client, { workflow: chain([{ provider: "claude", model: "sonnet" }, {}, {}, { agent: "continue:a", provider: "claude", model: "opus" }]), onClose });
    await providersLoaded();
    pick(4, "Ship");

    const warning = screen.getByText(/Switching model drops the prompt cache and re-reads the session at full price/);
    fireEvent.click(screen.getByRole("button", { name: /^Save( changes)?$/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(warning).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("round-trips provider, model and the continue source through save", async () => {
    const client = fakeClient();
    const onClose = vi.fn();
    open(client, { workflow: chain([{ extraPrompt: "kept" }]), onClose });
    await providersLoaded();
    pick(4, "Ship");

    fireEvent.change(screen.getByLabelText("Continue from"), { target: { value: "b" } });
    pick(2, "Build");
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "claude" } });
    fireEvent.change(await screen.findByRole("combobox", { name: "Model" }), { target: { value: "opus" } });
    pick(4, "Ship");
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "claude" } });
    fireEvent.change(await screen.findByRole("combobox", { name: "Model" }), { target: { value: "opus" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save( changes)?$/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const saved = client.updateWorkflow.mock.calls[0][0].steps;
    expect(saved[0]).toMatchObject({ agent: "new", extraPrompt: "kept" });
    expect(saved[1]).toMatchObject({ agent: "handoff", provider: "claude", model: "opus" });
    expect(saved[3]).toMatchObject({ agent: "continue:b", provider: "claude", model: "opus" });
    expect(saved[2]).not.toHaveProperty("provider");
  });

  it("explains what Send back resets and whose agent resumes", () => {
    open(fakeClient(), { workflow: chain([]), onClose: vi.fn() });

    pick(3, "Check");

    expect(
      screen.getByText(
        "Resets the code to before step 2 and resumes step 1's agent, which hasn't seen the rejected work. Starts a fresh agent if step 1 has no session.",
      ),
    ).toBeInTheDocument();
  });
});

describe("deriveInputName", () => {
  it("makes a valid unique identifier from a question", () => {
    const name = deriveInputName("  1st: which PR?? ", ["st-which-PR"]);

    expect(name).toBe("st-which-PR-2");
  });
});

describe("new step defaults", () => {
  it("starts with the provider and model of the nearest earlier agent step", async () => {
    llm.listProviders.mockResolvedValue([provider("claude", "claude")]);
    llm.fetchProviderModels.mockResolvedValue({ supported: true, models: [{ id: "opus", label: null }] });
    const client = fakeClient();
    open(client, {
      workflow: { id: "w", name: "W", steps: [{ id: "a", slug: "Plan", kind: "agent", prompt: "p", agent: "new", provider: "claude", model: "opus" }] },
      onClose: vi.fn(),
    });
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /Add step/ }));

    expect((screen.getByLabelText("Provider") as HTMLSelectElement).value).toBe("claude");
  });
});
