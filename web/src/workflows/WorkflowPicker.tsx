import { useEffect, useState } from "react";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { KIND_META } from "./runControls";
import { useWorkflows, workflowActions, workflowStore } from "./workflowStore";
import type { SkillInfo, WorkflowDef, WorkflowInput, WorkflowStepDef } from "./types";

type StepDraft = WorkflowStepDef & { skill: string };
type Errors = { name?: string; inputs?: Record<number, string>; steps?: Record<number, string> };

const INPUT_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

function newStep(slug = ""): StepDraft {
  return { id: crypto.randomUUID(), slug, kind: "agent", prompt: "", skill: "" };
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
    const missing = [!step.slug.trim() && "title", !step.prompt.trim() && "instructions"].filter(Boolean);
    if (missing.length > 0) (errors.steps ??= {})[i] = `Fill in the ${missing.join(" and ")}.`;
  });
  return errors;
}

function hasErrors(errors: Errors): boolean {
  return Boolean(errors.name || errors.inputs || errors.steps);
}

/** The Run workflow panel: pick a workflow to run (asking for its inputs), delete one, or build a new one. */
export function WorkflowPicker({ onClose }: { onClose: () => void }) {
  const client = useEngineClient();
  const workflows = useWorkflows();
  const [creating, setCreating] = useState(workflows.length === 0);
  const [running, setRunning] = useState<WorkflowDef | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (workflow: WorkflowDef, inputs?: Record<string, string>) => {
    setBusy(true);
    setError(null);
    await workflowActions(client).start(workflow.id, inputs);
    setBusy(false);
    const startError = workflowStore.getError();
    if (startError) setError(startError);
    else onClose();
  };

  const remove = async (workflow: WorkflowDef) => {
    setBusy(true);
    setError(null);
    await workflowActions(client).deleteWorkflow(workflow.id);
    setBusy(false);
    setConfirmDelete(null);
    const deleteError = workflowStore.getError();
    if (deleteError) setError(deleteError);
  };

  const heading = creating ? "New workflow" : running ? `Run: ${running.name}` : "Run workflow";
  return (
    <div className="workflow-picker" aria-label="Run workflow">
      <div className="workflow-picker-heading">
        <strong>{heading}</strong>
        <button type="button" aria-label="Close workflow picker" disabled={busy} onClick={onClose}>
          ×
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {creating ? (
        <WorkflowBuilder
          onCancel={workflows.length > 0 ? () => setCreating(false) : onClose}
          onSaved={() => setCreating(false)}
        />
      ) : running ? (
        <InputsForm
          workflow={running}
          busy={busy}
          onCancel={() => setRunning(null)}
          onStart={(values) => void start(running, values)}
        />
      ) : (
        <>
          {workflows.map((w) => (
            <div className="workflow-picker-row" key={w.id}>
              {confirmDelete === w.id ? (
                <>
                  <span>{`Delete "${w.name}"?`}</span>
                  <button type="button" disabled={busy} onClick={() => void remove(w)}>
                    Delete
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="workflow-picker-run"
                    aria-label={`Start run: ${w.name}`}
                    disabled={busy}
                    onClick={() => {
                      if (w.inputs?.length) setRunning(w);
                      else void start(w);
                    }}
                  >
                    <span>{w.name}</span>
                    <small>
                      {w.steps.length} steps{w.inputs?.length ? ` · asks for ${w.inputs.length} input${w.inputs.length > 1 ? "s" : ""}` : ""}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="workflow-picker-delete"
                    aria-label={`Delete workflow ${w.name}`}
                    disabled={busy}
                    onClick={() => setConfirmDelete(w.id)}
                  >
                    🗑
                  </button>
                </>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setCreating(true)}>
            ＋ Add new workflow
          </button>
        </>
      )}
    </div>
  );
}

/** Asks for the values a workflow's inputs need before its run starts. */
function InputsForm({
  workflow,
  busy,
  onCancel,
  onStart,
}: {
  workflow: WorkflowDef;
  busy: boolean;
  onCancel: () => void;
  onStart: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const inputs = workflow.inputs ?? [];
  const missing = inputs.some((input) => !values[input.name]?.trim());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!missing) onStart(values);
      }}
    >
      {inputs.map((input) => (
        <label key={input.name}>
          {input.label || input.name}
          <input
            value={values[input.name] ?? ""}
            aria-invalid={touched && !values[input.name]?.trim()}
            onChange={(e) => setValues({ ...values, [input.name]: e.target.value })}
          />
        </label>
      ))}
      {touched && missing && <p role="alert">Fill in every input to start the run.</p>}
      <div className="workflow-picker-actions">
        <button type="submit" disabled={busy}>
          ▷ Start run
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </form>
  );
}

/** The new-workflow form: inputs, then steps as an accordion with one step open at a time. */
function WorkflowBuilder({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const client = useEngineClient();
  const [name, setName] = useState("");
  const [inputs, setInputs] = useState<WorkflowInput[]>([]);
  const [steps, setSteps] = useState<StepDraft[]>([newStep("Plan")]);
  const [open, setOpen] = useState(0);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const patchStep = (i: number, patch: Partial<StepDraft>) =>
    setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const save = async () => {
    const found = validateDraft(name, inputs, steps);
    setErrors(found);
    if (hasErrors(found)) {
      const firstBad = Object.keys(found.steps ?? {})[0];
      if (firstBad !== undefined) setOpen(Number(firstBad));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.createWorkflow({
        id: `workflow-${crypto.randomUUID()}`,
        name: name.trim(),
        inputs: inputs.map((i) => ({ name: i.name.trim(), label: i.label.trim() || i.name.trim() })),
        steps: steps.map((s) => ({
          id: s.id,
          kind: s.kind,
          slug: s.slug.trim().replace(/\s+/g, "-"),
          prompt: s.prompt.trim(),
          ...(s.kind === "agent" && s.skill ? { skill: s.skill } : {}),
        })),
      });
      workflowStore.setWorkflows(await client.listWorkflows());
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {error && <p role="alert">{error}</p>}
      <label>
        Name
        <input
          value={name}
          aria-invalid={Boolean(errors.name)}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {errors.name && <p className="workflow-field-error" role="alert">{errors.name}</p>}

      <div className="workflow-builder-section">
        <strong>Inputs</strong>
        <small>
          Asked for when the run starts. Use {"{{name}}"} in a step&apos;s instructions to insert the value, e.g. a PR number.
        </small>
        {inputs.map((input, i) => (
          <fieldset key={i}>
            <label>
              Input name
              <input
                value={input.name}
                placeholder="pr"
                aria-invalid={Boolean(errors.inputs?.[i])}
                onChange={(e) => setInputs(inputs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
            </label>
            <label>
              Question to ask
              <input
                value={input.label}
                placeholder="Which PR number?"
                onChange={(e) => setInputs(inputs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
            </label>
            {errors.inputs?.[i] && <p className="workflow-field-error" role="alert">{errors.inputs[i]}</p>}
            <button type="button" onClick={() => setInputs(inputs.filter((_, j) => j !== i))}>
              Remove input
            </button>
          </fieldset>
        ))}
        <button type="button" onClick={() => setInputs([...inputs, { name: "", label: "" }])}>
          ＋ Add input
        </button>
      </div>

      {steps.map((step, i) => {
        const kind = KIND_META[step.kind];
        const expanded = open === i;
        return (
          <fieldset key={step.id} className="workflow-builder-step" data-kind={step.kind} data-invalid={Boolean(errors.steps?.[i])}>
            <button
              type="button"
              className="workflow-builder-step-head"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? -1 : i)}
            >
              <span style={{ color: kind.color }} aria-hidden="true">{kind.icon}</span>
              <strong>{`Step ${i + 1}`}</strong>
              <span>{step.slug || "untitled"}</span>
              {step.skill && <small>{step.skill}</small>}
              <small>{kind.text}</small>
            </button>
            {errors.steps?.[i] && <p className="workflow-field-error" role="alert">{errors.steps[i]}</p>}
            {expanded && (
              <>
                <label>
                  Title
                  <input
                    value={step.slug}
                    onChange={(e) => patchStep(i, { slug: e.target.value })}
                  />
                </label>
                <label>
                  Type
                  <select
                    value={step.kind}
                    onChange={(e) =>
                      patchStep(i, { kind: e.target.value as WorkflowStepDef["kind"], skill: "" })
                    }
                  >
                    <option value="agent">Agent</option>
                    <option value="review">Your review</option>
                  </select>
                </label>
                {step.kind === "agent" && (
                  <label>
                    Skill
                    <select value={step.skill} onChange={(e) => patchStep(i, { skill: e.target.value })}>
                      <option value="">No specific skill</option>
                      {skills.map((skill) => (
                        <option key={skill.name} value={skill.name} title={skill.description}>
                          {skill.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Instructions
                  <textarea
                    value={step.prompt}
                    onChange={(e) => patchStep(i, { prompt: e.target.value })}
                  />
                </label>
                {steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSteps(steps.filter((_, j) => j !== i));
                      setOpen(Math.max(0, i - 1));
                    }}
                  >
                    Remove step
                  </button>
                )}
              </>
            )}
          </fieldset>
        );
      })}
      <button
        type="button"
        onClick={() => {
          setSteps([...steps, newStep()]);
          setOpen(steps.length);
        }}
      >
        ＋ Add step
      </button>
      <div className="workflow-picker-actions">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save workflow"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
