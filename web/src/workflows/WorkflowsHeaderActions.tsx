import type { AgentsMode } from "../canvas/layout/layoutStore";
import { PanelModeActions } from "../agents/activity/PanelModeActions";
import { PlusIcon } from "../agents/activity/icons";
import { Icon } from "./icons";
import { useWorkflowView, workflowStore } from "./workflowStore";

/** The activity header's right side on the Workflows tab: Run workflow (New workflow on All workflows), the list, full screen and collapse. */
export function WorkflowsHeaderActions({
  agentsMode,
  disabled = false,
}: {
  agentsMode: AgentsMode;
  disabled?: boolean;
}) {
  const view = useWorkflowView();
  return (
    <>
      <span className="activity-spacer" />
      <span className="activity-break" aria-hidden="true" />
      {view === "all" ? (
        <button type="button" className="activity-primary" data-testid="new-workflow" disabled={disabled} onClick={() => workflowStore.setDialog({ kind: "editor" })}>
          <PlusIcon size={14} />
          New workflow
        </button>
      ) : (
        <>
          <button type="button" className="activity-primary" data-testid="run-workflow" disabled={disabled} onClick={() => workflowStore.setDialog({ kind: "run" })}>
            <Icon name="play" size={13} />
            Run workflow
          </button>
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
        </>
      )}
      <PanelModeActions agentsMode={agentsMode} />
    </>
  );
}
