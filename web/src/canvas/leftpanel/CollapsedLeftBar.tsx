import { layoutStore } from "../layout/layoutStore";
import { Z_COLLAPSED_LEFT_BAR } from "../layout/layoutMetrics";
import { colorForLayer } from "./diagramColors";
import { useDiagramRows } from "./useDiagramRows";
import "./CollapsedLeftBar.css";

/** The left panel's collapsed form: expand/files buttons plus one visibility swatch per diagram. */
export function CollapsedLeftBar() {
  const rows = useDiagramRows();

  return (
    <div className="collapsed-left-bar" data-testid="collapsed-left-bar" style={{ zIndex: Z_COLLAPSED_LEFT_BAR }}>
      <button
        type="button"
        className="collapsed-left-bar__expand"
        aria-label="Expand diagrams panel"
        onClick={() => layoutStore.openLeft("diagrams")}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      <button
        type="button"
        className="collapsed-left-bar__files"
        aria-label="Open Files"
        onClick={() => layoutStore.openLeft("files")}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      </button>
      <span className="collapsed-left-bar__divider" aria-hidden="true" />
      {rows.map(({ layer, hidden, toggleLabel, toggle }) => {
        const visible = !hidden;
        return (
          <button
            key={layer}
            type="button"
            className="collapsed-left-bar__diagram"
            aria-label={toggleLabel}
            aria-pressed={visible}
            onClick={toggle}
          >
            <span
              className={`collapsed-left-bar__swatch${visible ? "" : " collapsed-left-bar__swatch--hidden"}`}
              style={visible ? { background: colorForLayer(layer) } : undefined}
            />
          </button>
        );
      })}
    </div>
  );
}
