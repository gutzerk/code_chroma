import { useEffect, useState, type ReactNode } from "react";
import { ModalDialog } from "../agents/ModalDialog";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { fetchProviderModels, listProviders, type Provider, type ProviderModelsResult } from "../llm-settings/llmSettingsClient";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./icons";
import { stepModeLabel, stepSummary } from "./runControls";
import { useRuns, workflowActions, workflowStore } from "./workflowStore";
import {
  agentMode,
  continueSourceIndex,
  continueStepId,
  continueTargetIndex,
  nearestAgentBefore,
  workflowInputs,
  type AgentMode,
  type SkillInfo, type WorkflowDef, type WorkflowInput, type WorkflowStepDef } from "./types";
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
  return { ...step, skill: step.skill ?? "", agent: step.agent ?? "handoff", input: step.input ?? null };
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
  if (agentMode(step.agent) !== "continue" || check.error || i === 0) return check;
  if (check.continueOff) return { ...check, error: `Can't save. Only claude can resume a session, and this step uses ${provider?.label}.` };
  const j = continueTargetIndex(steps, i);
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
  return stepModeLabel(steps, i, (id) => providerName(providers, id)) ?? "Your step";
}

/** The Send back explanation for review step `at`: which step it reruns and whose agent resumes. */
function sendBackHint(steps: StepDraft[], at: number): string | null {
  const chosen = steps.findIndex((s, j) => j < at && s.id === steps[at].sendBackTo && s.kind === "agent");
  const target = chosen >= 0 ? chosen : nearestAgentBefore(steps, at);
  if (target < 0) return null;
  const prior = nearestAgentBefore(steps, target);
  if (prior < 0) return `Resets the code to before step ${target + 1} and reruns it with a fresh agent.`;
  return `Resets the code to before step ${target + 1} and resumes step ${prior + 1}'s agent, which hasn't seen the rejected work. Starts a fresh agent if step ${prior + 1} has no session.`;
}

/** The connector label between a step and the one before it (null: a plain line), as the design's step rail shows it. */
export function connector(steps: StepDraft[], index: number): { text: string; tone: "handoff" | "you" | "continue" } | null {
  const next = steps[index];
  if (next.kind === "review") return { text: "diff → you", tone: "you" };
  const mode = agentMode(next.agent);
  if (mode === "new") return null;
  if (mode === "continue") {
    const source = continueSourceIndex(steps, index);
    return { text: source >= 0 ? `resumes step ${source + 1}'s agent` : "resumes an earlier agent", tone: "continue" };
  }
  return { text: `hand-off → step ${index + 1}`, tone: "handoff" };
}

function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="wfe-field">
      <span className="wfe-label">
        {label}
        {hint && <span className="wfe-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** The modal workflow editor (design boards 6 and 7): create a workflow or edit one, step by step. */
export function WorkflowEditorDialog({
  workflow,
  onClose,
}: {
  workflow?: WorkflowDef;
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
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [models, setModels] = useState<Record<string, ProviderModelsResult | null>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

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

  const activeRuns = workflow
    ? runs.filter((r) => r.workflowId === workflow.id && r.state !== "done" && r.state !== "stopped").length
    : 0;
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
        agent: i === 0 ? "new" : s.agent,
        ...(s.extraPrompt?.trim() ? { extraPrompt: s.extraPrompt.trim() } : {}),
        ...(s.provider ? { provider: s.provider } : {}),
        ...(s.model ? { model: s.model } : {}),
        input: s.input && s.input.label.trim() ? { name: s.input.name, label: s.input.label.trim() } : null,
        pauseBefore: s.pauseBefore ?? false,
        ...(s.skill ? { skill: s.skill } : {}),
      };
    }),
  });

  const snapshot = (): string => JSON.stringify({ ...build(), id: "" });
  const [initial] = useState(snapshot);
  const dirty = snapshot() !== initial;
  const requestClose = (): void => (dirty ? setConfirmDiscard(true) : onClose());

  const fail = (message: string): void => {
    workflowStore.setError(null);
    setError(message);
    setBusy(false);
  };

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
    const actions = workflowActions(client);
    const def = build();
    const failure = await (workflow ? actions.updateWorkflow(def) : actions.createWorkflow(def));
    if (failure) return fail(failure);
    if (andRun && workflowInputs(def).length > 0) {
      const saved = workflowStore.getWorkflows().find((w) => w.id === def.id) ?? def;
      workflowStore.setDialog({ kind: "run", workflow: saved });
      return;
    }
    if (andRun) {
      const startFailure = await actions.start(def.id);
      if (startFailure) return fail(startFailure);
    }
    onClose();
  };

  const deleteWorkflow = async () => {
    if (!workflow) return;
    setConfirmDelete(false);
    setBusy(true);
    const failure = await workflowActions(client).deleteWorkflow(workflow.id);
    if (failure) fail(failure);
    else onClose();
  };

  const earlierAgents = steps.slice(0, at).filter((s) => s.kind === "agent");
  const stepError = errors.steps?.[at];
  const check = checks[at];
  const mode: AgentMode = at === 0 ? "new" : agentMode(step.agent);
  const agentCards: { mode: AgentMode; title: string; text: string; disabled: boolean }[] = [
    { mode: "new", title: "New", text: "Fresh agent with only this step's instructions.", disabled: false },
    { mode: "handoff", title: "New + hand-off", text: `Fresh agent, plus step ${at}'s output and changes.`, disabled: at === 0 },
    { mode: "continue", title: "Continue", text: "Resumes an earlier step's agent. claude only.", disabled: Boolean(check.continueOff) && mode !== "continue" },
  ];
  const nearest = nearestAgentBefore(steps, at);
  const target = step.kind === "agent" && continueStepId(step.agent) !== null ? continueTargetIndex(steps, at) : -1;
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
    <ModalDialog label="Workflow editor" className="wfe" onDismiss={busy || confirmDiscard || confirmDelete ? undefined : requestClose}>
      <div className="wfe-head">
        <h2 className="wfe-title">{workflow ? "Edit workflow" : "New workflow"}</h2>
        <label className="wfe-name">
          <span>Name</span>
          <input
            aria-label="Workflow name"
            value={name}
            aria-invalid={Boolean(errors.name)}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button type="button" className="wfe-close" aria-label="Close" disabled={busy} onClick={requestClose}>
          <Icon name="cancel" size={18} />
        </button>
      </div>
      {errors.name && (
        <p className="wfe-error wfe-error-bar" role="alert">
          {errors.name}
        </p>
      )}
      {activeRuns > 0 && (
        <div className="wfe-banner" role="status">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6M12 7.5v.5" />
          </svg>
          {`${activeRuns} run${activeRuns === 1 ? " is" : "s are"} using this workflow now. ${activeRuns === 1 ? "It keeps" : "They keep"} the old version; changes apply to new runs.`}
        </div>
      )}

      <div className="wfe-body">
        <div className="wfe-left">
          <div className="wfe-left-title">Steps</div>
          <ol className="wfe-steps" aria-label="Steps">
            {steps.map((s, i) => {
              const link = i > 0 ? connector(steps, i) : null;
              const touches = i === at || i - 1 === at;
              return (
                <li key={s.id}>
                  {i > 0 && (
                    <div
                      className="wfe-link"
                      aria-hidden="true"
                      data-testid={`between-${i}`}
                      data-tone={link?.tone ?? (touches ? "active" : undefined)}
                    >
                      <span className="wfe-link-line" />
                      {link && <span className="wfe-link-text">{link.text}</span>}
                    </div>
                  )}
                  <button
                    type="button"
                    className="wfe-step"
                    data-selected={i === at}
                    data-kind={s.kind}
                    data-invalid={Boolean(errors.steps?.[i] || checks[i].error)}
                    aria-current={i === at}
                    aria-label={`Step ${i + 1}: ${s.slug || "untitled"}`}
                    onClick={() => setSelected(i)}
                  >
                    <span className="wfe-num">{i + 1}</span>
                    <span className="wfe-step-text">
                      <span className="wfe-step-title">{s.slug || "untitled"}</span>
                      <span className="wfe-step-sub">{stepMeta(steps, i, providers)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            className="wfe-add-step"
            onClick={() => {
              setSteps([...steps, newStep()]);
              setSelected(steps.length);
            }}
          >
            <Icon name="plus" size={16} />
            Add step
          </button>
        </div>

        <div className="wfe-right" aria-label="Step editor">
          <div className="wfe-right-head">
            <span className="wfe-step-count">{`Step ${at + 1} of ${steps.length}`}</span>
            <button type="button" className="wfe-tool" aria-label="Move step up" disabled={at === 0} onClick={() => move(at, -1)}>
              <Icon name="chevron-up" size={15} />
            </button>
            <button type="button" className="wfe-tool" aria-label="Move step down" disabled={at === steps.length - 1} onClick={() => move(at, 1)}>
              <Icon name="chevron-down" size={15} />
            </button>
            <button type="button" className="wfe-tool wfe-tool-danger" aria-label="Delete step" disabled={steps.length < 2} onClick={() => remove(at)}>
              <Icon name="trash" size={15} />
            </button>
          </div>
          {stepError && (
            <p className="wfe-error" role="alert">
              {stepError}
            </p>
          )}

          <div className="wfe-row">
            <Field label="Step title">
              <input className="wfe-input" value={step.slug} onChange={(e) => patch(at, { slug: e.target.value })} />
            </Field>
            <div className="wfe-field">
              <span className="wfe-label" id="who-label">
                Who does it
              </span>
              <div className="wfe-segment" role="radiogroup" aria-labelledby="who-label">
                {(["agent", "review"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={step.kind === kind}
                    data-kind={kind}
                    onClick={() => patch(at, { kind, ...(kind === "review" ? { skill: "" } : {}) })}
                  >
                    {kind === "agent" ? "Agent" : "You"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {step.kind === "agent" ? (
            <>
              <fieldset className="wfe-fieldset">
                <legend className="wfe-label">Agent</legend>
                <div className="wfe-cards">
                  {agentCards.map((card) => (
                    <label key={card.mode} className="wfe-card" data-checked={mode === card.mode} data-disabled={card.disabled || undefined}>
                      <input
                        type="radio"
                        name={`agent-${step.id}`}
                        aria-label={card.title}
                        checked={mode === card.mode}
                        disabled={card.disabled}
                        onChange={() => patch(at, { agent: card.mode })}
                      />
                      <span>
                        <span className="wfe-card-title">
                          {card.title}
                          {card.mode === "new" && <small> · default</small>}
                        </span>
                        <span className="wfe-card-text">{card.text}</span>
                        {card.mode === "continue" && at > 0 && (
                          <select
                            className="wfe-input wfe-card-select"
                            aria-label="Continue from"
                            aria-invalid={Boolean(check.error)}
                            disabled={mode !== "continue"}
                            value={continueStepId(step.agent) ?? ""}
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
                {check.continueOff && <small className="wfe-hint-block">{check.continueOff}</small>}
                {check.error && (
                  <p className="wfe-error" role="alert">
                    {check.error}
                  </p>
                )}
                {check.warning && (
                  <p className="wfe-warning" role="status">
                    {check.warning}
                  </p>
                )}
              </fieldset>

              <div className="wfe-row wfe-row-even">
                <Field label="Provider">
                  <select className="wfe-input" value={step.provider ?? ""} onChange={(e) => patch(at, { provider: e.target.value || null, model: null })}>
                    <option value="">Default (workflow setting)</option>
                    {providerOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Model">
                  {listed ? (
                    <select className="wfe-input" value={step.model ?? ""} onChange={(e) => patch(at, { model: e.target.value || null })}>
                      <option value="">Default (workflow setting)</option>
                      {modelOptions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label || m.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="wfe-input"
                      value={step.model ?? ""}
                      disabled={!step.provider}
                      placeholder="Default (workflow setting)"
                      onChange={(e) => patch(at, { model: e.target.value.trim() ? e.target.value : null })}
                    />
                  )}
                </Field>
              </div>

              <div className="wfe-stack">
                <Field label="Instructions" hint="Use {{input}} to insert a run input by name">
                  <textarea
                    className="wfe-input wfe-textarea"
                    rows={6}
                    value={step.prompt}
                    onChange={(e) => patch(at, { prompt: e.target.value })}
                  />
                </Field>
                <Field label="Ask for input when the run starts" hint="(optional)">
                  <input
                    className="wfe-input"
                    value={step.input?.label ?? ""}
                    placeholder="Which PR number?"
                    onChange={(e) => setQuestion(at, e.target.value)}
                  />
                  {step.input && (
                    <span className="wfe-hint-block">
                      {`Use {{${step.input.name}}} in the instructions to insert the answer. `}
                      <button type="button" className="wfe-add-input" onClick={insertInput}>
                        Insert
                      </button>
                    </span>
                  )}
                </Field>
                <Field label="Step input" hint="(optional) Added after the instructions, for this step only">
                  <textarea
                    className="wfe-input wfe-textarea"
                    rows={3}
                    value={step.extraPrompt ?? ""}
                    placeholder="Extra notes for this step…"
                    onChange={(e) => patch(at, { extraPrompt: e.target.value || null })}
                  />
                </Field>
              </div>

              <div className="wfe-row wfe-row-even">
                <Field label="Skill" hint="(optional)">
                  <select className="wfe-input" value={step.skill} onChange={(e) => patch(at, { skill: e.target.value })}>
                    <option value="">None</option>
                    {skills.map((skill) => (
                      <option key={skill.name} value={skill.name} title={skill.description}>
                        {skill.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="wfe-check wfe-check-end">
                  <input type="checkbox" checked={step.pauseBefore ?? false} onChange={(e) => patch(at, { pauseBefore: e.target.checked })} />
                  <span>Pause before this step</span>
                </label>
              </div>
            </>
          ) : (
            <>
              <div className="wfe-info">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0 1 16 0" />
                </svg>
                <div>
                  <div className="wfe-info-title">The run waits for you here</div>
                  <div className="wfe-info-text">
                    No instructions needed. You&apos;ll get a notification and choose Approve to continue, or Send back with a note.
                  </div>
                </div>
              </div>
              <fieldset className="wfe-fieldset">
                <legend className="wfe-label">When it&apos;s your turn, show</legend>
                <label className="wfe-check" data-tone="you">
                  <input type="checkbox" checked={step.showDiff ?? false} onChange={(e) => patch(at, { showDiff: e.target.checked })} />
                  <span>{at > 0 ? `Changes made by step ${at} (diff on the canvas)` : "The changes (diff on the canvas)"}</span>
                </label>
                <label className="wfe-check" data-tone="you">
                  <input type="checkbox" checked={step.showSummary ?? false} onChange={(e) => patch(at, { showSummary: e.target.checked })} />
                  <span>{at > 0 ? `Step ${at} agent's summary` : "The previous agent's summary"}</span>
                </label>
              </fieldset>
              <label className="wfe-field wfe-narrow">
                <span className="wfe-label">Send back reruns</span>
                <select className="wfe-input" value={step.sendBackTo ?? ""} onChange={(e) => patch(at, { sendBackTo: e.target.value || null })}>
                  <option value="">The previous agent step</option>
                  {earlierAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {`Step ${steps.indexOf(a) + 1} · ${a.slug || "untitled"}`}
                    </option>
                  ))}
                </select>
                <span className="wfe-hint-block">{backHint ?? "Reruns that step with your note, on top of its earlier result."}</span>
              </label>
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="wfe-error wfe-error-bar" role="alert">
          {error}
        </p>
      )}
      <div className="wfe-foot">
        {workflow && (
          <button type="button" className="wfe-delete" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete workflow
          </button>
        )}
        <span className="wfe-foot-note" data-dirty={dirty || undefined}>
          {dirty ? "Unsaved changes" : stepSummary(steps)}
        </span>
        <button type="button" className="wfe-ghost" disabled={busy} onClick={requestClose}>
          Cancel
        </button>
        {workflow ? (
          <button type="button" className="wfe-primary" disabled={busy} onClick={() => void save(false)}>
            Save changes
          </button>
        ) : (
          <>
            <button type="button" className="wfe-secondary" disabled={busy} onClick={() => void save(false)}>
              Save
            </button>
            <button type="button" className="wfe-primary" disabled={busy} onClick={() => void save(true)}>
              <Icon name="play" size={14} />
              Save and run
            </button>
          </>
        )}
      </div>
      {confirmDiscard && (
        <ConfirmDialog
          label="Discard changes"
          message="Your unsaved changes to this workflow will be lost."
          confirmLabel="Discard"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={onClose}
        />
      )}
      {confirmDelete && workflow && (
        <ConfirmDialog
          label="Delete workflow"
          message={`Delete "${workflow.name}"?`}
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void deleteWorkflow()}
        />
      )}
    </ModalDialog>
  );
}
