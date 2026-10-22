import { useEffect, useMemo, useState } from "react";
import "./workflows.css";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { Icon } from "./icons";
import { RunDetail } from "./RunDetail";
import { RunWorkflowDialog } from "./RunWorkflowDialog";
import { RunsList } from "./RunsList";
import { useContainerLayout } from "./useContainerLayout";
import { WorkflowEditorDialog } from "./WorkflowEditorDialog";
import {
  bindWorkflows,
  useActiveRunId,
  useRuns,
  useWorkflowError,
  useWorkflows,
  workflowActions,
  workflowStore,
} from "./workflowStore";
import type { WorkflowDef } from "./types";

type Dialog = { kind: "run"; workflow?: WorkflowDef } | { kind: "editor"; workflow?: WorkflowDef } | null;

/** The Workflows tab: run lists and saved workflows, plus the run detail; the layout follows the container width. */
export function WorkflowsTab() {
  const client = useEngineClient();
  const workflows = useWorkflows();
  const runs = useRuns();
  const activeRunId = useActiveRunId();
  const error = useWorkflowError();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [ref, layout] = useContainerLayout();
  const actions = useMemo(() => workflowActions(client), [client]);

  useEffect(() => bindWorkflows(client), [client]);

  const side = layout === "side" || layout === "full";
  const showList = side || activeRunId === null;
  const showDetail = side || activeRunId !== null;

  const runSaved = (workflow: WorkflowDef) => {
    if (workflow.inputs?.length) setDialog({ kind: "run", workflow });
    else void actions.start(workflow.id);
  };

  return (
    <div className="workflows-tab" ref={ref} data-layout={layout} data-testid="workflows-tab">
      {error && (
        <p className="workflow-error" role="alert">
          {error}
        </p>
      )}
      <div className="wf-toolbar">
        <button type="button" className="wf-btn wf-btn-primary" data-testid="run-workflow" onClick={() => setDialog({ kind: "run" })}>
          <Icon name="play" />
          Run workflow
        </button>
        <button type="button" className="wf-btn" data-testid="new-workflow" onClick={() => setDialog({ kind: "editor" })}>
          <Icon name="plus" />
          New workflow
        </button>
      </div>
      <div className="wf-columns">
        {showList && (
          <div className="wf-list-col">
            <RunsList
              runs={runs}
              workflows={workflows}
              activeRunId={activeRunId}
              layout={layout}
              actions={actions}
              onOpen={workflowStore.setActiveRun}
              onEdit={(workflow) => setDialog({ kind: "editor", workflow })}
              onRun={runSaved}
            />
          </div>
        )}
        {showDetail && (
          <div className="wf-detail-col">
            {activeRunId ? (
              <RunDetail runId={activeRunId} layout={layout} onBack={side ? undefined : () => workflowStore.setActiveRun(null)} />
            ) : (
              <p className="workflow-empty">Select a run to see its steps.</p>
            )}
          </div>
        )}
      </div>
      {dialog?.kind === "run" && <RunWorkflowDialog workflow={dialog.workflow} onClose={() => setDialog(null)} />}
      {dialog?.kind === "editor" && <WorkflowEditorDialog workflow={dialog.workflow} onClose={() => setDialog(null)} />}
    </div>
  );
}
