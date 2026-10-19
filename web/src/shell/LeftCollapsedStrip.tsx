import { RailIcon } from "../icons/RailIcon";
import { COLLAPSED_STRIP_WIDTH, shellStore } from "./shellStore";
import "./leftPanel.css";

/** Slim strip shown when the left panel is collapsed: one icon button per tab. */
export function LeftCollapsedStrip() {
  return (
    <div
      className="left-strip"
      data-testid="left-collapsed-strip"
      style={{ width: COLLAPSED_STRIP_WIDTH }}
    >
      <button
        type="button"
        className="left-strip-button"
        aria-label="Open Diagrams"
        onClick={() => shellStore.openLeft("diagrams")}
      >
        <RailIcon name="hierarchy" />
      </button>
      <button
        type="button"
        className="left-strip-button"
        aria-label="Open Files"
        onClick={() => shellStore.openLeft("files")}
      >
        <RailIcon name="code-inline" />
      </button>
    </div>
  );
}
