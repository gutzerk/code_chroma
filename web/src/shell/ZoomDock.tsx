import "./zoomDock.css";

export interface ZoomDockProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitAll: () => void;
}

/** Bottom-left zoom controls: out, percent, in, Fit All. */
export function ZoomDock({ scale, onZoomIn, onZoomOut, onFitAll }: ZoomDockProps) {
  return (
    <div className="zoom-dock" data-testid="zoom-dock">
      <button type="button" className="zoom-dock-button" aria-label="Zoom out" onClick={onZoomOut}>
        −
      </button>
      <span className="zoom-dock-percent" data-testid="zoom-percent">
        {Math.round(scale * 100)}%
      </span>
      <button type="button" className="zoom-dock-button" aria-label="Zoom in" onClick={onZoomIn}>
        +
      </button>
      <button
        type="button"
        className="zoom-dock-button zoom-dock-fit"
        data-testid="fit-all-button"
        aria-label="Fit all open blocks"
        onClick={onFitAll}
      >
        Fit All
      </button>
    </div>
  );
}
