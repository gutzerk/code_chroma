import { useState } from "react";
import { RailButton } from "../canvas/RailButton";
import { RailIcon } from "../icons/RailIcon";
import { WorkflowRunScreen } from "./WorkflowRunScreen";

/** The top bar Workflows control: toggles the docked run screen, self-contained like ReportIssueRailButton. */
export function WorkflowsRailButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <RailButton
        label="Workflows"
        tooltip="Run and steer a workflow"
        className="workflows-toggle-button"
        testId="workflows-toggle-button"
        pressed={open}
        onClick={() => setOpen((current) => !current)}
      >
        <RailIcon name="workflows" />
      </RailButton>
      {open && (
        <div className="workflow-dock" data-testid="workflow-dock">
          <WorkflowRunScreen />
        </div>
      )}
    </>
  );
}
