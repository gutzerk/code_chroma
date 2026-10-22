import { useEffect, useState } from "react";
import { ModalDialog } from "../agents/ModalDialog";
import { messageOf } from "../util/reportError";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { KIND_META } from "./runControls";
import { useRuns, workflowActions, workflowStore } from "./workflowStore";
import type { SkillInfo, WorkflowDef, WorkflowInput, WorkflowStepDef } from "./types";
import "./workflows.css";
import "./WorkflowEditorDialog.css";

export type StepDraft = WorkflowStepDef & { skill: string };
type Errors = { name?: string; inputs?: Record<number, string>; steps?: Record<number, string> };

const INPUT_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

function newStep(): StepDraft {
  return { id: crypto.randomUUID(), slug: "", kind: "agent", prompt: "", skill: "", context: "previous" };
}

/** What stops a draft from being saved, keyed by the field group it belongs to. */
export function validateDraft(name: string, inputs: WorkflowInput[], steps: StepDraft[]): Errors {
  const errors: Errors = {};
  if (!name.trim()) errors.name = "Give the workflow a name.";
  inputs.forEach((input, i) => {
    const problem = !input.name.trim()
      ? "Give the input a name."
      : !INPUT_NAME.test(input.name.trim())
        ? "Use letters, digits, - or _ and start with a letter."
        : inputs.findIndex((other) => other.name.trim() === input.name.trim()) !== i
          ? "Input names must be unique."
          : null;
    if (problem) (errors.inputs ??= {})[i] = problem;
  });
  steps.forEach((step, i) => {
    const needsPrompt = step.kind === "agent";
    const missing = [!step.slug.trim() && "title", needsPrompt && !step.prompt.trim() && "instructions"].filter(Boolean);
    if (missing.length > 0) (errors.steps ??= {})[i] = `Fill in the ${missing.join(" and ")}.`;
  });
  return errors;
}

function toDraft(step: WorkflowStepDef): StepDraft {
  return { ...step, skill: step.skill ?? "", context: step.context ?? "previous" };
}

/** The label between a step and the one after it, as the run timeline shows it. */
export function betweenLabel(next: StepDraft, nextNumber: number): string {
  if (next.kind === "review") return "You review the diff";
  if (next.context === "fresh") return "Fresh start · no context";
  return `Passes output to step ${nextNumber}`;
}

/** The modal workflow editor: create a workflow or edit one, step by step. */
export function WorkflowEditorDialog({
  workflow,
  runAfterSave,
  onClose,
}: {
  workflow?: WorkflowDef;
  runAfterSave?: boolean;
  onClose: () => void;
}) {
  const client = useEngineClient();
  const runs = useRuns();
  const [name, setName] = useState(workflow?.name ?? "");
  const [inputs, setInputs] = useState<WorkflowInput[]>(workflow?.inputs ?? []);
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    workflow?.steps.length ? workflow.steps.map(toDraft) : [{ ...newStep(), slug: "Plan" }],
  );
  const [selected, setSelected] = useState(0);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    client
      .listSkills()
      .then((found) => live && setSkills(found))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [client]);

  const inUse = Boolean(
    workflow && runs.some((r) => r.workflowId === workflow.id && r.state !== "done" && r.state !== "stopped"),
  );
  const at = Math.min(selected, steps.length - 1);
  const step = steps[at];

  const patch = (i: number, change: Partial<StepDraft>) =>
    setSteps(steps.map((s, j) => (j === i ? { ...s, ...change } : s)));

  const move = (i: number, by: -1 | 1) => {
    const to = i + by;
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    [next[i], next[to]] = [next[to], next[i]];
    setSteps(next);
    setSelected(to);
  };

  const remove = (i: number) => {
    const gone = steps[i].id;
    const next = steps
      .filter((_, j) => j !== i)
      .map((s) => (s.sendBackTo === gone ? { ...s, sendBackTo: null } : s));
    setSteps(next);
    setSelected(Math.max(0, i - 1));
  };

  const build = (): WorkflowDef => ({
    id: workflow?.id ?? `workflow-${crypto.randomUUID()}`,
    name: name.trim(),
    inputs: inputs.map((i) => ({ name: i.name.trim(), label: i.label.trim() || i.name.trim() })),
    steps: steps.map((s, i): WorkflowStepDef => {
      const base = { id: s.id, kind: s.kind, slug: s.slug.trim().replace(/\s+/g, "-") };
      if (s.kind === "review") {
        return {
          ...base,
          prompt: "",
          showDiff: s.showDiff ?? false,
          showSummary: s.showSummary ?? false,
          sendBackTo: steps.slice(0, i).some((e) => e.id === s.sendBackTo && e.kind === "agent") ? s.sendBackTo : null,
        };
      }
      return {
        ...base,
        prompt: s.prompt.trim(),
        context: i === 0 ? "fresh" : (s.context ?? "previous"),
        pauseBefore: s.pauseBefore ?? false,
        ...(s.skill ? { skill: s.skill } : {}),
      };
    }),
  });

  const save = async (andRun: boolean) => {
    const found = validateDraft(name, inputs, steps);
    setErrors(found);
    if (found.name || found.inputs || found.steps) {
      const firstBad = Object.keys(found.steps ?? {})[0];
      if (firstBad !== undefined) setSelected(Number(firstBad));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const def = build();
      if (workflow) await client.updateWorkflow(def);
      else await client.createWorkflow(def);
      workflowStore.setWorkflows(await client.listWorkflows());
      if (andRun && (def.inputs?.length ?? 0) > 0) {
        setNotice("Saved. This workflow asks for inputs, so start it from the Workflows tab.");
        setBusy(false);
        return;
      }
      if (andRun) {
        await workflowActions(client).start(def.id);
        const startError = workflowStore.getError();
        if (startError) {
          setError(startError);
          setBusy(false);
          return;
        }
      }
      onClose();
    } catch (err) {
      setError(messageOf(err));
    }
    setBusy(false);
  };

  const earlierAgents = steps.slice(0, at).filter((s) => s.kind === "agent");
  const stepError = errors.steps?.[at];

  return (
    <ModalDialog label="Workflow editor" className="agent-dialog-wide workflow-editor" onDismiss={busy ? undefined : onClose}>
      <h2 className="agent-dialog-title">{workflow ? "Edit workflow" : "New workflow"}</h2>
      {inUse && (
        <p className="workflow-editor-banner" role="status">
          A run is using this workflow; changes apply to runs started afterwards.
        </p>
      )}
      <label className="workflow-editor-field">
        Workflow name
        <input
          value={name}
          aria-invalid={Boolean(errors.name)}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {errors.name && <p className="agent-dialog-error" role="alert">{errors.name}</p>}

      <div className="workflow-editor-columns">
        <div className="workflow-editor-left">
          <section className="workflow-editor-section">
            <strong>Run inputs</strong>
            <small>
              Asked for when the run starts. Use {"{{name}}"} in instructions to insert the value.
            </small>
            {inputs.map((input, i) => (
              <div className="workflow-editor-input" key={i}>
                <input
                  aria-label={`Input ${i + 1} name`}
                  value={input.name}
                  placeholder="pr"
                  aria-invalid={Boolean(errors.inputs?.[i])}
                  onChange={(e) => setInputs(inputs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <input
                  aria-label={`Input ${i + 1} question`}
                  value={input.label}
                  placeholder="Which PR number?"
                  onChange={(e) => setInputs(inputs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                <button type="button" aria-label={`Remove input ${i + 1}`} onClick={() => setInputs(inputs.filter((_, j) => j !== i))}>
                  Remove
                </button>
                {errors.inputs?.[i] && <p className="agent-dialog-error" role="alert">{errors.inputs[i]}</p>}
              </div>
            ))}
            <button type="button" onClick={() => setInputs([...inputs, { name: "", label: "" }])}>
              Add input
            </button>
          </section>

          <ol className="workflow-editor-steps" aria-label="Steps">
            {steps.map((s, i) => {
              const meta = KIND_META[s.kind];
              return (
                <li key={s.id}>
                  {i > 0 && (
                    <div className="workflow-editor-between" data-testid={`between-${i}`}>
                      {betweenLabel(s, i + 1)}
                    </div>
                  )}
                  <button
                    type="button"
                    className="workflow-editor-step"
                    data-selected={i === at}
                    data-invalid={Boolean(errors.steps?.[i])}
                    aria-current={i === at}
                    aria-label={`Step ${i + 1}: ${s.slug || "untitled"}`}
                    onClick={() => setSelected(i)}
                  >
                    <span className="workflow-editor-num">{i + 1}</span>
                    <span className="workflow-editor-step-title">{s.slug || "untitled"}</span>
                    <small style={{ color: meta.color }}>{s.kind === "agent" ? "Agent" : "You"}</small>
                  </button>
                </li>
              );
            })}
          </ol>
          <button type="button" onClick={() => { setSteps([...steps, newStep()]); setSelected(steps.length); }}>
            Add step
          </button>
        </div>

        <div className="workflow-editor-right" aria-label="Step editor">
          {stepError && <p className="agent-dialog-error" role="alert">{stepError}</p>}
          <label className="workflow-editor-field">
            Step title
            <input value={step.slug} onChange={(e) => patch(at, { slug: e.target.value })} />
          </label>
          <div className="workflow-editor-field">
            <span id="who-label">Who does it</span>
            <div className="workflow-editor-segment" role="group" aria-labelledby="who-label">
              {(["agent", "review"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={step.kind === kind}
                  onClick={() => patch(at, { kind, ...(kind === "review" ? { skill: "" } : {}) })}
                >
                  {kind === "agent" ? "Agent" : "You"}
                </button>
              ))}
            </div>
          </div>

          {step.kind === "agent" ? (
            <>
              <label className="workflow-editor-field">
                Instructions
                <textarea
                  className="agent-dialog-textarea"
                  value={step.prompt}
                  onChange={(e) => patch(at, { prompt: e.target.value })}
                />
                <small>Use {"{{input}}"} to insert a run input by name.</small>
              </label>
              <div className="workflow-editor-field">
                <span id="ctx-label">Context</span>
                <div className="workflow-editor-segment" role="group" aria-labelledby="ctx-label">
                  <button
                    type="button"
                    disabled={at === 0}
                    aria-pressed={at > 0 && step.context !== "fresh"}
                    onClick={() => patch(at, { context: "previous" })}
                  >
                    {at > 0 ? `Continue from step ${at}` : "Continue from previous step"}
                  </button>
                  <button
                    type="button"
                    disabled={at === 0}
                    aria-pressed={at === 0 || step.context === "fresh"}
                    onClick={() => patch(at, { context: "fresh" })}
                  >
                    Start fresh
                  </button>
                </div>
              </div>
              <label className="workflow-editor-field">
                Skill (optional)
                <select value={step.skill} onChange={(e) => patch(at, { skill: e.target.value })}>
                  <option value="">No specific skill</option>
                  {skills.map((skill) => (
                    <option key={skill.name} value={skill.name} title={skill.description}>
                      {skill.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="agent-dialog-check">
                <input
                  type="checkbox"
                  checked={step.pauseBefore ?? false}
                  onChange={(e) => patch(at, { pauseBefore: e.target.checked })}
                />
                Pause before this step
              </label>
            </>
          ) : (
            <>
              <label className="agent-dialog-check">
                <input
                  type="checkbox"
                  checked={step.showDiff ?? false}
                  onChange={(e) => patch(at, { showDiff: e.target.checked })}
                />
                Show the diff
              </label>
              <label className="agent-dialog-check">
                <input
                  type="checkbox"
                  checked={step.showSummary ?? false}
                  onChange={(e) => patch(at, { showSummary: e.target.checked })}
                />
                Show the previous agent&apos;s summary
              </label>
              <label className="workflow-editor-field">
                Send back reruns
                <select
                  value={step.sendBackTo ?? ""}
                  onChange={(e) => patch(at, { sendBackTo: e.target.value || null })}
                >
                  <option value="">The previous agent step</option>
                  {earlierAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {`Step ${steps.indexOf(a) + 1}: ${a.slug || "untitled"}`}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <div className="workflow-editor-tools">
            <button type="button" disabled={at === 0} onClick={() => move(at, -1)}>
              Move up
            </button>
            <button type="button" disabled={at === steps.length - 1} onClick={() => move(at, 1)}>
              Move down
            </button>
            <button type="button" disabled={steps.length < 2} onClick={() => remove(at)}>
              Delete step
            </button>
          </div>
        </div>
      </div>

      {error && <p className="agent-dialog-error" role="alert">{error}</p>}
      {notice && <p className="workflow-editor-notice" role="status">{notice}</p>}
      <div className="agent-dialog-actions">
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={busy} onClick={() => void save(Boolean(runAfterSave))}>
          Save
        </button>
        <button type="button" className="agent-dialog-primary" disabled={busy} onClick={() => void save(true)}>
          Save and run
        </button>
      </div>
    </ModalDialog>
  );
}
