import { RailButton } from "../canvas/RailButton";
import { RailIcon } from "../icons/RailIcon";
import { SettingsDialog } from "./SettingsDialog";
import { settingsStore, useSettingsState } from "./settingsStore";

/** The rail's assistant-settings control: opens the dialog that picks the CLI, model, credentials
 * and instructions. Open state lives in settingsStore so other chrome can open a category directly. */
export function SettingsRailButton() {
  const { open } = useSettingsState();

  return (
    <>
      <RailButton
        label="Assistant settings"
        className="assistant-settings-toggle-button"
        testId="assistant-settings-toggle-button"
        pressed={open}
        onClick={settingsStore.toggle}
      >
        <RailIcon name="settings" />
      </RailButton>
      {open && <SettingsDialog onDismiss={settingsStore.close} />}
    </>
  );
}
