import { useEffect, useState } from "react";
import { ModalDialog } from "../agents/ModalDialog";
import { messageOf } from "../util/reportError";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { fetchProviderModels, listProviders, type Provider, type ProviderModelsResult } from "../llm-settings/llmSettingsClient";
import { KIND_META } from "./runControls";
import { useRuns, workflowActions, workflowStore } from "./workflowStore";
import { continueSourceIndex, workflowInputs, type SkillInfo, type WorkflowDef, type WorkflowInput, type WorkflowStepDef } from "./types";
import "./workflows.css";
import "./WorkflowEditorDialog.css";

export type StepDraft = WorkflowStepDef & { skill: string };
type Errors = { name?: string; steps?: Record<number, string> };
/** An agent step's live checks (board 7b): a Save-blocking error, a non-blocking warning, why Continue is off. */
export type AgentCheck = { error?: string; warning?: string; continueOff?: string };
export type ProviderInfo = Pick<Provider, "id" | "label" | "kind" | "adapter">;

function newStep(): StepDraft {
  return { id: crypto.randomUUID(), slug: "", kind: "agent", prompt: "", skill: "", agent: "new" };
}

/** What stops a draft from being saved, keyed by the field group it belongs to. */
export function validateDraft(name: string, steps: StepDraft[]): Errors {
  const errors: Errors = {};
  if (!name.trim()) errors.name = "Give the workflow a name.";
  steps.forEach((step, i) => {
    const needsPrompt = step.kind === "agent";
    const missing = [!step.slug.trim() && "title", needsPrompt && !step.prompt.trim() && "instructions"].filter(Boolean);
    if (missing.length > 0) (errors.steps ??= {})[i] = `Fill in the ${missing.join(" and ")}.`;
  });
  return errors;
}

/** The identifier an input gets from its question (letters, digits, - and _), unique among the others. */
export function deriveInputName(label: string, others: string[]): string {
  const base =
    label
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^[^A-Za-z]+|-+$/g, "") || "input";
  let name = base;
  for (let n = 2; others.includes(name); n += 1) name = `${base}-${n}`;
  return name;
}

/** The input names every step but `except` already uses, so a new one stays unique. */
function otherInputNames(steps: StepDraft[], except: number): string[] {
  return steps.flatMap((s, i) => (i !== except && s.input ? [s.input.name] : []));
}

function toDraft(step: WorkflowStepDef): StepDraft {
  const legacy = (step as { context?: string }).context;
  return { ...step, skill: step.skill ?? "", agent: step.agent ?? (legacy === "fresh" ? "new" : "handoff"), input: step.input ?? null };
}

/** Binds older workflow-level inputs to steps: the agent step that mentions it, else the first agent step without one. */
function bindLegacyInputs(steps: StepDraft[], legacy: WorkflowInput[]): StepDraft[] {
  const bound = steps.map((s) => ({ ...s }));
  for (const input of legacy) {
    if (bound.some((s) => s.input?.name === input.name)) continue;
    const mention = bound.find((s) => s.kind === "agent" && !s.input && s.prompt.includes(`{{${input.name}}}`));
    const target = mention ?? bound.find((s) => s.kind === "agent" && !s.input);
    if (target) target.input = input;
  }
  return bound;
}

type AgentMode = "new" | "handoff" | "continue";

const isContinue = (agent: StepDraft["agent"]) => Boolean(agent?.startsWith("continue"));

/** The step a continue names, even a later or review one, so the editor can say what is wrong; -1 when none. */
function continueTarget(steps: StepDraft[], i: number): number {
  const agent = steps[i].agent;
  if (agent === "continue") return continueSourceIndex(steps, i);
  return agent?.startsWith("continue:") ? steps.findIndex((s) => s.id === agent.slice("continue:".length)) : -1;
}

function providerName(providers: ProviderInfo[] | null, id: string | null | undefined): string {
  return id ? (providers?.find((p) => p.id === id)?.label ?? id) : "the default provider";
}

/** The checks WorkflowValidation.cs runs on save, for step `i`; `providers` is null until the list loads. */
export function agentCheck(steps: StepDraft[], i: number, providers: ProviderInfo[] | null): AgentCheck {
  const step = steps[i];
  if (step.kind !== "agent") return {};
  const check: AgentCheck = {};
  const provider = step.provider ? providers?.find((p) => p.id === step.provider) : undefined;
  if (step.provider && providers && (!provider || provider.kind !== "cli"))
    check.error = `Can't save. ${providerName(providers, step.provider)} isn't a CLI provider a step can run on.`;
  if (i === 0) check.continueOff = "Step 1 can only be New.";
  else if (provider && provider.adapter !== "claude")
    check.continueOff = `Continue is off. Only claude can resume a session, and this step uses ${provider.label}.`;
  if (!isContinue(step.agent) || check.error || i === 0) return check;
  if (check.continueOff) return { ...check, error: `Can't save. Only claude can resume a session, and this step uses ${provider?.label}.` };
  const j = continueTarget(steps, i);
  if (j < 0) return { ...check, error: "Can't save. There is no earlier agent step to continue. Switch to New." };
  if (j >= i) return { ...check, error: `Can't save. Step ${j + 1} comes after this step. Pick an earlier one.` };
  const source = steps[j];
  if (source.kind !== "agent") return { ...check, error: `Can't save. A "You" step has no agent session to continue.` };
  if ((step.provider || null) !== (source.provider || null))
    return {
      ...check,
      error: `Can't save. Step ${j + 1} runs on ${providerName(providers, source.provider)} and this step on ${providerName(providers, step.provider)}. Pick another step or switch to New.`,
    };
  if ((step.model || null) !== (source.model || null))
    check.warning = "Allowed. Switching model drops the prompt cache and re-reads the session at full price.";
  return check;
}

/** The rail's second line for a step: who does it, on which provider, in which agent mode. */
export function stepMeta(steps: StepDraft[], i: number, providers: ProviderInfo[] | null): string {
  const step = steps[i];
  if (step.kind === "review") return "You";
  const provider = step.provider ? providerName(providers, step.provider) : "default";
  const agent = i === 0 ? "new" : step.agent;
  let mode = "new";
  if (agent === "handoff") mode = "new + hand-off";
  else if (isContinue(agent)) mode = `continue: ${steps[continueTarget(steps, i)]?.slug || "?"}`;
  return `Agent · ${provider} · ${mode}`;
}

/** The label between step `index` and the one before it, as the run timeline shows it. */
export function betweenLabel(steps: StepDraft[], index: number): string {
  const next = steps[index];
  if (next.kind === "review") return "You review the diff";
  if (next.agent === "new") return "Fresh start · no context";
  if (isContinue(next.agent)) {
    const source = continueSourceIndex(steps, index);
    return source >= 0 ? `resumes step ${source + 1}'s agent` : "resumes an earlier agent";
  }
  return `hand-off → step ${index + 1}`;
}

/** The Send back explanation for review step `at`: which step it reruns and whose agent resumes. */
function sendBackHint(steps: StepDraft[], at: number): string | null {
  const nearestAgent = (before: number) => steps.slice(0, before).map((s) => s.kind).lastIndexOf("agent");
  const chosen = steps.findIndex((s, j) => j < at && s.id === steps[at].sendBackTo && s.kind === "agent");
  const target = chosen >= 0 ? chosen : nearestAgent(at);
  if (target < 0) return null;
  const prior = nearestAgent(target);
  if (prior < 0) return `Resets the code to before step ${target + 1} and reruns it with a fresh agent.`;
  return `Resets the code to before step ${target + 1} and resumes step ${prior + 1}'s agent, which hasn't seen the rejected work. Starts a fresh agent if step ${prior + 1} has no session.`;
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
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    workflow?.steps.length
      ? bindLegacyInputs(workflow.steps.map(toDraft), workflow.inputs ?? [])
      : [{ ...newStep(), slug: "Plan" }],
  );
  const [selected, setSelected] = useState(0);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [models, setModels] = useState<Record<string, ProviderModelsResult | null>>({});

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

  useEffect(() => {
    let live = true;
    listProviders()
      .then((found) => live && setProviders(found))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const inUse = Boolean(
    workflow && runs.some((r) => r.workflowId === workflow.id && r.state !== "done" && r.state !== "stopped"),
  );
  const at = Math.min(selected, steps.length - 1);
  const step = steps[at];
  const checks = steps.map((_, i) => agentCheck(steps, i, providers));
  const providerId = step.kind === "agent" ? step.provider : null;

  useEffect(() => {
    if (!providerId || providerId in models) return;
    setModels((m) => ({ ...m, [providerId]: null }));
    fetchProviderModels(providerId)
      .then((found) => setModels((m) => ({ ...m, [providerId]: found })))
      .catch(() => setModels((m) => ({ ...m, [providerId]: { supported: false, models: [] } })));
  }, [providerId, models]);

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

  const setQuestion = (i: number, label: string) =>
    patch(i, {
      input: label.trim()
        ? { name: steps[i].input?.name ?? deriveInputName(label, otherInputNames(steps, i)), label }
        : null,
    });

  const insertInput = () => {
    const name = step.input?.name;
    if (name && step.kind === "agent") patch(at, { prompt: `${step.prompt}${step.prompt && !/\s$/.test(step.prompt) ? " " : ""}{{${name}}}` });
  };

  const remove = (i: number) => {
    const gone = steps[i].id;
    const next = steps
      .filter((_, j) => j !== i)
      .map((s) => (s.sendBackTo === gone ? { ...s, sendBackTo: null } : s))
      .map((s) => (s.agent === `continue:${gone}` ? { ...s, agent: "continue" as const } : s));
    setSteps(next);
    setSelected(Math.max(0, i - 1));
  };

  const build = (): WorkflowDef => ({
    id: workflow?.id ?? `workflow-${crypto.randomUUID()}`,
    name: name.trim(),
    inputs: [],
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
        agent: i === 0 ? "new" : (s.agent ?? "new"),
        ...(s.extraPrompt?.trim() ? { extraPrompt: s.extraPrompt.trim() } : {}),
        ...(s.provider ? { provider: s.provider } : {}),
        ...(s.model ? { model: s.model } : {}),
        input: s.input && s.input.label.trim() ? { name: s.input.name, label: s.input.label.trim() } : null,
        pauseBefore: s.pauseBefore ?? false,
        ...(s.skill ? { skill: s.skill } : {}),
      };
    }),
  });

  const save = async (andRun: boolean) => {
    const found = validateDraft(name, steps);
    setErrors(found);
    if (found.name || found.steps) {
      const firstBad = Object.keys(found.steps ?? {})[0];
      if (firstBad !== undefined) setSelected(Number(firstBad));
      return;
    }
    const agentBad = checks.findIndex((c) => c.error);
    if (agentBad >= 0) {
      setSelected(agentBad);
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
      if (andRun && workflowInputs(def).length > 0) {
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
  const check = checks[at];
  const mode: AgentMode = at === 0 || !step.agent ? "new" : isContinue(step.agent) ? "continue" : step.agent === "handoff" ? "handoff" : "new";
  const agentCards: { mode: AgentMode; title: string; text: string; disabled: boolean }[] = [
    { mode: "new", title: "New", text: "Fresh agent with only this step's instructions.", disabled: false },
    { mode: "handoff", title: "New + hand-off", text: `Fresh agent, plus step ${at}'s output and changes.`, disabled: at === 0 },
    { mode: "continue", title: "Continue", text: "Resumes an earlier step's agent. claude only.", disabled: Boolean(check.continueOff) && mode !== "continue" },
  ];
  const nearest = at > 0 ? steps.slice(0, at).map((s) => s.kind).lastIndexOf("agent") : -1;
  const target = step.kind === "agent" && step.agent?.startsWith("continue:") ? continueTarget(steps, at) : -1;
  const sourceOptions = steps.flatMap((s, j) => ((j < at && s.kind === "agent") || j === target ? [j] : []));
  const sourceLabel = (j: number) => {
    const s = steps[j];
    const note = s.kind === "review" ? " (you)" : j > at ? " (later step)" : s.provider ? ` (${providerName(providers, s.provider)})` : "";
    return `Step ${j + 1} · ${s.slug || "untitled"}${note}`;
  };
  const providerOptions = (providers ?? []).filter((p) => p.kind === "cli" || p.id === step.provider);
  if (step.provider && !providerOptions.some((p) => p.id === step.provider))
    providerOptions.push({ id: step.provider, label: step.provider, kind: "cli", adapter: null });
  const catalog = step.provider ? models[step.provider] : null;
  const listed = Boolean(catalog?.supported && catalog.models.length > 0);
  const modelOptions = [...(catalog?.models ?? [])];
  if (step.model && !modelOptions.some((m) => m.id === step.model)) modelOptions.push({ id: step.model, label: null });
  const backHint = step.kind === "review" ? sendBackHint(steps, at) : null;

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
          <ol className="workflow-editor-steps" aria-label="Steps">
            {steps.map((s, i) => {
              const meta = KIND_META[s.kind];
              return (
                <li key={s.id}>
                  {i > 0 && (
                    <div
                      className="workflow-editor-between"
                      data-testid={`between-${i}`}
                      data-mode={s.kind === "review" ? "review" : isContinue(s.agent) ? "continue" : s.agent}
                    >
                      {betweenLabel(steps, i)}
                    </div>
                  )}
                  <button
                    type="button"
                    className="workflow-editor-step"
                    data-selected={i === at}
                    data-invalid={Boolean(errors.steps?.[i] || checks[i].error)}
                    aria-current={i === at}
                    aria-label={`Step ${i + 1}: ${s.slug || "untitled"}`}
                    onClick={() => setSelected(i)}
                  >
                    <span className="workflow-editor-num">{i + 1}</span>
                    <span className="workflow-editor-step-title">{s.slug || "untitled"}</span>
                    <small style={{ color: meta.color }}>{stepMeta(steps, i, providers)}</small>
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
              <fieldset className="workflow-editor-agent">
                <legend>Agent</legend>
                <div className="workflow-editor-agent-cards">
                  {agentCards.map((card) => (
                    <label key={card.mode} className="workflow-editor-agent-card" data-checked={mode === card.mode} data-disabled={card.disabled}>
                      <input
                        type="radio"
                        name={`agent-${step.id}`}
                        aria-label={card.title}
                        checked={mode === card.mode}
                        disabled={card.disabled}
                        onChange={() => patch(at, { agent: card.mode })}
                      />
                      <span className="workflow-editor-agent-text">
                        <strong>
                          {card.title}
                          {card.mode === "new" && <small> · default</small>}
                        </strong>
                        <small>{card.text}</small>
                        {card.mode === "continue" && at > 0 && (
                          <select
                            aria-label="Continue from"
                            aria-invalid={Boolean(check.error)}
                            disabled={mode !== "continue"}
                            value={step.agent?.startsWith("continue:") ? step.agent.slice("continue:".length) : ""}
                            onChange={(e) => patch(at, { agent: e.target.value ? `continue:${e.target.value}` : "continue" })}
                          >
                            <option value="">
                              {nearest >= 0 ? `Nearest earlier · Step ${nearest + 1} · ${steps[nearest].slug || "untitled"}` : "Nearest earlier agent step"}
                            </option>
                            {sourceOptions.map((j) => (
                              <option key={steps[j].id} value={steps[j].id}>
                                {sourceLabel(j)}
                              </option>
                            ))}
                          </select>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                {check.continueOff && <small className="workflow-editor-agent-reason">{check.continueOff}</small>}
                {check.error && <p className="agent-dialog-error" role="alert">{check.error}</p>}
                {check.warning && <p className="workflow-editor-warning" role="status">{check.warning}</p>}
              </fieldset>
              <div className="workflow-editor-pair">
                <label className="workflow-editor-field">
                  Provider
                  <select value={step.provider ?? ""} onChange={(e) => patch(at, { provider: e.target.value || null, model: null })}>
                    <option value="">Default (workflow setting)</option>
                    {providerOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="workflow-editor-field">
                  Model
                  {listed ? (
                    <select value={step.model ?? ""} onChange={(e) => patch(at, { model: e.target.value || null })}>
                      <option value="">Default (workflow setting)</option>
                      {modelOptions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label || m.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={step.model ?? ""}
                      disabled={!step.provider}
                      placeholder="Default (workflow setting)"
                      onChange={(e) => patch(at, { model: e.target.value.trim() ? e.target.value : null })}
                    />
                  )}
                </label>
              </div>
              <label className="workflow-editor-field">
                Instructions
                <textarea
                  className="agent-dialog-textarea"
                  value={step.prompt}
                  onChange={(e) => patch(at, { prompt: e.target.value })}
                />
                <small>Use {"{{input}}"} to insert a run input by name.</small>
              </label>
              <label className="workflow-editor-field">
                Ask for input when the run starts (optional)
                <input
                  value={step.input?.label ?? ""}
                  placeholder="Which PR number?"
                  onChange={(e) => setQuestion(at, e.target.value)}
                />
                {step.input && (
                  <small className="workflow-editor-input-name">
                    {`Use {{${step.input.name}}} in the instructions to insert the answer. `}
                    <button type="button" onClick={insertInput}>
                      Insert
                    </button>
                  </small>
                )}
              </label>
              <label className="workflow-editor-field">
                Step input (optional)
                <textarea
                  className="agent-dialog-textarea workflow-editor-extra"
                  value={step.extraPrompt ?? ""}
                  placeholder="Extra notes for this step…"
                  onChange={(e) => patch(at, { extraPrompt: e.target.value || null })}
                />
                <small>Added after the instructions, for this step only</small>
              </label>
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
                {backHint && <small className="workflow-editor-hint">{backHint}</small>}
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
