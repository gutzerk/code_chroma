import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { RailButton } from "./RailButton";
import { RailIcon } from "../icons/RailIcon";
import { useDisclosureMenu } from "../util/useDisclosureMenu";
import {
  DISPLAY_SCALE_OPTIONS,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  useAutoDisplayScale,
  useZoomSettings,
  zoomSettingsStore,
} from "./zoomSettingsStore";

const percent = (value: number) => `${Math.round(value * 100)}%`;

const SENSITIVITY_ROWS = [
  { key: "mouse", label: "Mouse wheel zoom" },
  { key: "trackpad", label: "Trackpad zoom" },
] as const;

/** Rail control under the zoom buttons: mouse and trackpad zoom sensitivity plus the canvas display scale. */
export function ZoomSettingsMenu() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { containerRef, triggerRef, onListKeyDown } = useDisclosureMenu(open, close);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const settings = useZoomSettings();
  const autoScale = useAutoDisplayScale();

  // Opening moves focus to the first control, so a keyboard user lands inside the dialog.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>("input, select, button")?.focus();
  }, [open]);

  const onScaleChange = (e: ChangeEvent<HTMLSelectElement>) =>
    zoomSettingsStore.set({ displayScale: e.target.value === "auto" ? "auto" : Number(e.target.value) });

  return (
    <div className="zoom-settings" ref={containerRef} onKeyDown={open ? onListKeyDown : undefined}>
      <RailButton
        ref={triggerRef}
        label="Zoom settings"
        testId="zoom-settings-button"
        ariaExpanded={open}
        ariaControls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <RailIcon name="zoom-settings" />
      </RailButton>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className="zoom-settings-panel"
          data-testid="zoom-settings-panel"
          role="dialog"
          aria-label="Zoom settings"
        >
          {SENSITIVITY_ROWS.map(({ key, label }) => (
            <label key={key} className="zoom-settings-row">
              <span>{label}</span>
              <output>{percent(settings[key])}</output>
              <input
                type="range"
                data-testid={`zoom-settings-${key}`}
                min={SENSITIVITY_MIN}
                max={SENSITIVITY_MAX}
                step={0.05}
                value={settings[key]}
                aria-valuetext={percent(settings[key])}
                onChange={(e) => zoomSettingsStore.set({ [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label className="zoom-settings-row">
            <span>Canvas scale</span>
            <select
              data-testid="zoom-settings-scale"
              value={String(settings.displayScale)}
              onChange={onScaleChange}
            >
              <option value="auto">{`Auto (${percent(autoScale)})`}</option>
              {DISPLAY_SCALE_OPTIONS.map((scale) => (
                <option key={scale} value={String(scale)}>
                  {percent(scale)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="zoom-settings-reset"
            data-testid="zoom-settings-reset"
            onClick={() => zoomSettingsStore.restoreDefaults()}
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}
