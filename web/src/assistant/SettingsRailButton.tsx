import { useState } from "react";
import { RailButton } from "../canvas/RailButton";
import { RailIcon } from "../icons/RailIcon";
import { SettingsDialog } from "./SettingsDialog";

/** The rail's assistant-settings control: opens the dialog that picks the CLI, model, credentials
 * and instructions. Self-contained so RootCanvas only renders it, not its open state. */
export function SettingsRailButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <RailButton
        label="Assistant settings"
        className="assistant-settings-toggle-button"
        testId="assistant-settings-toggle-button"
        pressed={open}
        onClick={() => setOpen((current) => !current)}
      >
        <RailIcon name="settings" />
      </RailButton>
      {open && <SettingsDialog onDismiss={() => setOpen(false)} />}
    </>
  );
}
