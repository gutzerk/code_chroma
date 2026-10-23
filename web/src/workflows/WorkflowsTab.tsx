import { useEffect, useMemo } from "react";
import "./workflows.css";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { AllWorkflows } from "./AllWorkflows";
import { RunDetail } from "./RunDetail";
import { RunWorkflowDialog } from "./RunWorkflowDialog";
import { RunsList } from "./RunsList";
import { useContainerLayout } from "./useContainerLayout";
import { WorkflowEditorDialog } from "./WorkflowEditorDialog";
import {
  bindWorkflows,
  useActiveRunId,
  useRuns,
  useWorkflowDialog,
  useWorkflowError,
  useWorkflowView,
  useWorkflows,
  workflowActions,
  workflowStore,
} from "./workflowStore";
import { workflowInputs, type WorkflowDef } from "./types";

/** The Workflows tab body: the run overview with the run detail, or the All workflows screen; the layout follows the container width. */
export function WorkflowsTab() {
  const client = useEngineClient();
  const workflows = useWorkflows();
  const runs = useRuns();
  const activeRunId = useActiveRunId();
  const error = useWorkflowError();
  const view = useWorkflowView();
  const dialog = useWorkflowDialog();
  const [ref, layout] = useContainerLayout();
  const actions = useMemo(() => workflowActions(client), [client]);

  useEffect(() => bindWorkflows(client), [client]);

  const side = layout === "side" || layout === "full";
  const showList = side || activeRunId === null;
  const showDetail = side || activeRunId !== null;

  const runSaved = (workflow: WorkflowDef) => {
    if (workflowInputs(workflow).length) workflowStore.setDialog({ kind: "run", workflow });
    else void actions.start(workflow.id);
  };

  return (
    <div className="workflows-tab" ref={ref} data-layout={layout} data-view={view} data-testid="workflows-tab">
      {error && (
        <p className="workflow-error" role="alert">
          {error}
        </p>
      )}
      {view === "all" ? (
        <AllWorkflows
          workflows={workflows}
          runs={runs}
          actions={actions}
          onBack={() => workflowStore.setView("runs")}
          onEdit={(workflow) => workflowStore.setDialog({ kind: "editor", workflow })}
          onRun={runSaved}
        />
      ) : (
        <div className="wf-columns">
          {showList && (
            <div className="wf-list-col">
              <RunsList runs={runs} workflows={workflows} activeRunId={activeRunId} layout={layout} actions={actions} onOpen={workflowStore.setActiveRun} />
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
      )}
      {dialog?.kind === "run" && <RunWorkflowDialog workflow={dialog.workflow} onClose={() => workflowStore.setDialog(null)} />}
      {dialog?.kind === "editor" && <WorkflowEditorDialog workflow={dialog.workflow} onClose={() => workflowStore.setDialog(null)} />}
    </div>
  );
}
