import type { AgentsMode } from "../canvas/layout/layoutStore";
import { PanelModeActions } from "../agents/activity/PanelModeActions";
import { PlusIcon } from "../agents/activity/icons";
import { Icon } from "./icons";
import { useWorkflows, useWorkflowView, workflowStore } from "./workflowStore";

/** The activity header's right side on the Workflows tab: New workflow, Run workflow (once one is saved), the list, full screen and collapse. */
export function WorkflowsHeaderActions({
  agentsMode,
  disabled = false,
}: {
  agentsMode: AgentsMode;
  disabled?: boolean;
}) {
  const view = useWorkflowView();
  const hasWorkflows = useWorkflows().length > 0;
  const openNewWorkflow = () => workflowStore.setDialog({ kind: "create" });
  const newPrimary = view === "all" || !hasWorkflows;
  return (
    <>
      <span className="activity-spacer" />
      <span className="activity-break" aria-hidden="true" />
      {newPrimary ? (
        <button type="button" className="activity-primary" data-testid="new-workflow" disabled={disabled} onClick={openNewWorkflow}>
          <PlusIcon size={14} />
          New workflow
        </button>
      ) : (
        <>
          <button
            type="button"
            className="activity-icon-btn activity-ghost"
            aria-label="New workflow"
            title="New workflow"
            data-testid="new-workflow"
            disabled={disabled}
            onClick={openNewWorkflow}
          >
            <PlusIcon size={16} />
          </button>
          <button type="button" className="activity-primary" data-testid="run-workflow" disabled={disabled} onClick={() => workflowStore.setDialog({ kind: "run" })}>
            <Icon name="play" size={13} />
            Run workflow
          </button>
        </>
      )}
      {view !== "all" && (
        <button
          type="button"
          className="activity-icon-btn activity-ghost"
          aria-label="All workflows"
          title="All workflows"
          data-testid="all-workflows-button"
          onClick={() => workflowStore.setView("all")}
        >
          <Icon name="list" size={16} />
        </button>
      )}
      <PanelModeActions agentsMode={agentsMode} />
    </>
  );
}
