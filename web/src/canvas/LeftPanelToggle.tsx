import { layoutStore, useLayoutState } from "./layout/layoutStore";
import "./LeftPanelToggle.css";

/** Top-bar button that shows or hides the left diagrams panel. */
export function LeftPanelToggle() {
  const { leftOpen } = useLayoutState();
  return (
    <button
      type="button"
      className="left-panel-toggle"
      data-testid="left-panel-toggle"
      aria-label={leftOpen ? "Hide diagrams panel" : "Show diagrams panel"}
      aria-pressed={leftOpen}
      onClick={layoutStore.toggleLeft}
    >
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M9 4v16" />
      </svg>
    </button>
  );
}
