import { useState } from "react";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { useWorkflows, workflowActions, workflowStore } from "./workflowStore";
import type { WorkflowStepDef } from "./types";

export function WorkflowPicker({ onClose }: { onClose: () => void }) {
  const client = useEngineClient();
  const workflows = useWorkflows();
  const [creating, setCreating] = useState(workflows.length === 0);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<WorkflowStepDef[]>([
    { id: "step1", slug: "Plan", kind: "agent", prompt: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.createWorkflow({
        id: `workflow-${crypto.randomUUID()}`,
        name: name.trim(),
        steps: steps.map((s) => ({ ...s, slug: s.slug.trim().replace(/\s+/g, "-"), prompt: s.prompt.trim() })),
      });
      workflowStore.setWorkflows(await client.listWorkflows());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="workflow-picker" aria-label="Run workflow">
      <div className="workflow-picker-heading">
        <strong>{creating ? "New workflow" : "Run workflow"}</strong>
        <button type="button" aria-label="Close workflow picker" disabled={busy} onClick={onClose}>
          ×
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {creating ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {steps.map((step, i) => (
            <fieldset key={step.id}>
              <legend>Step {i + 1}</legend>
              <label>
                Title
                <input
                  required
                  value={step.slug}
                  onChange={(e) =>
                    setSteps(steps.map((s, j) => (j === i ? { ...s, slug: e.target.value } : s)))
                  }
                />
              </label>
              <label>
                Type
                <select
                  value={step.kind}
                  onChange={(e) =>
                    setSteps(
                      steps.map((s, j) =>
                        j === i ? { ...s, kind: e.target.value as WorkflowStepDef["kind"] } : s,
                      ),
                    )
                  }
                >
                  <option value="agent">Agent</option>
                  <option value="review">Your review</option>
                </select>
              </label>
              <label>
                Instructions
                <textarea
                  required
                  value={step.prompt}
                  onChange={(e) =>
                    setSteps(steps.map((s, j) => (j === i ? { ...s, prompt: e.target.value } : s)))
                  }
                />
              </label>
              {steps.length > 1 && (
                <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                  Remove step
                </button>
              )}
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() =>
              setSteps([...steps, { id: crypto.randomUUID(), slug: "", prompt: "", kind: "agent" }])
            }
          >
            ＋ Add step
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim() || steps.some((s) => !s.slug.trim() || !s.prompt.trim())}
          >
            {busy ? "Saving…" : "Save workflow"}
          </button>
        </form>
      ) : (
        <>
          {workflows.map((w) => (
            <button
              type="button"
              key={w.id}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await workflowActions(client).start(w.id);
                setBusy(false);
                const startError = workflowStore.getError();
                if (startError) setError(startError);
                else onClose();
              }}
            >
              <span>{w.name}</span>
              <small>{w.steps.length} steps</small>
            </button>
          ))}
          <button type="button" onClick={() => setCreating(true)}>
            ＋ Add new workflow
          </button>
        </>
      )}
    </div>
  );
}
