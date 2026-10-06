import { useState } from "react";
import { RailButton } from "../canvas/RailButton";
import { RailIcon } from "../icons/RailIcon";
import { CreateIssueDialog } from "./CreateIssueDialog";

/** The top bar's "Report an issue" control: opens the Create issue dialog, self-contained like SettingsRailButton. */
export function ReportIssueRailButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <RailButton
        label="Report an issue"
        tooltip="Found a bug or have an idea? Report it on GitHub"
        className="report-issue-toggle-button"
        testId="report-issue-toggle-button"
        pressed={open}
        onClick={() => setOpen((current) => !current)}
      >
        <RailIcon name="report-issue" />
        <span className="report-issue-label">Report issue</span>
      </RailButton>
      {open && <CreateIssueDialog onDismiss={() => setOpen(false)} />}
    </>
  );
}
