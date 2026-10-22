import { useEffect, useMemo, useState } from "react";
import "./workflows.css";
import { layoutStore, useLayoutState } from "../canvas/layout/layoutStore";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { AllWorkflows } from "./AllWorkflows";
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
import { workflowInputs, type WorkflowDef } from "./types";

type Dialog = { kind: "run"; workflow?: WorkflowDef } | { kind: "editor"; workflow?: WorkflowDef } | null;

/** The Workflows tab: run lists plus the run detail, or the All workflows screen; the layout follows the container width. */
export function WorkflowsTab() {
  const client = useEngineClient();
  const workflows = useWorkflows();
  const runs = useRuns();
  const activeRunId = useActiveRunId();
  const error = useWorkflowError();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [allOpen, setAllOpen] = useState(false);
  const { agentsMode } = useLayoutState();
  const panelFull = agentsMode === "full";
  const [ref, layout] = useContainerLayout();
  const actions = useMemo(() => workflowActions(client), [client]);

  useEffect(() => bindWorkflows(client), [client]);

  const side = layout === "side" || layout === "full";
  const showList = side || activeRunId === null;
  const showDetail = side || activeRunId !== null;

  const runSaved = (workflow: WorkflowDef) => {
    setAllOpen(false);
    if (workflowInputs(workflow).length) setDialog({ kind: "run", workflow });
    else void actions.start(workflow.id);
  };

  const runsView = (
    <>
      <div className="wf-toolbar">
        <button type="button" className="wf-btn wf-btn-primary" data-testid="run-workflow" onClick={() => setDialog({ kind: "run" })}>
          <Icon name="play" />
          Run workflow
        </button>
        {side && (
          <div className="wf-toolbar-end">
            <button type="button" className="wf-btn wf-btn-icon" aria-label="All workflows" title="All workflows" onClick={() => setAllOpen(true)}>
              <Icon name="list" />
            </button>
            <button
              type="button"
              className="wf-btn wf-btn-icon"
              aria-label={panelFull ? "Exit full screen" : "Full screen"}
              title={panelFull ? "Exit full screen" : "Full screen"}
              aria-pressed={panelFull}
              onClick={() => layoutStore.setAgentsMode(panelFull ? "normal" : "full")}
            >
              <Icon name={panelFull ? "shrink" : "expand"} />
            </button>
          </div>
        )}
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
              onAllWorkflows={() => setAllOpen(true)}
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
    </>
  );

  return (
    <div className="workflows-tab" ref={ref} data-layout={layout} data-testid="workflows-tab">
      {error && (
        <p className="workflow-error" role="alert">
          {error}
        </p>
      )}
      {allOpen ? (
        <AllWorkflows
          workflows={workflows}
          runs={runs}
          actions={actions}
          onBack={() => setAllOpen(false)}
          onNew={() => setDialog({ kind: "editor" })}
          onEdit={(workflow) => setDialog({ kind: "editor", workflow })}
          onRun={runSaved}
        />
      ) : (
        runsView
      )}
      {dialog?.kind === "run" && <RunWorkflowDialog workflow={dialog.workflow} onClose={() => setDialog(null)} />}
      {dialog?.kind === "editor" && <WorkflowEditorDialog workflow={dialog.workflow} onClose={() => setDialog(null)} />}
    </div>
  );
}
