import type { CollapseKind } from "./impactGlanceLogic";
import { impactExpandStore } from "./impactBoxState";

/** A collapsed Impact box: a quiet pill naming it, opened in place by a click. */
export function ImpactPill({
  collapse,
  elementId,
  label,
  left,
  top,
  width,
}: {
  collapse: CollapseKind;
  elementId: string;
  label: string;
  left: number;
  top: number;
  width: number;
}) {
  return (
    <button
      type="button"
      className="impact-pill"
      data-testid="impact-pill"
      data-impact-pill={collapse}
      data-select-id={elementId}
      style={{ position: "absolute", left, top, width }}
      onClick={() => impactExpandStore.expand(elementId)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="impact-pill-label" title={label}>
        {label} · {collapse === "unchanged" ? "unchanged" : "modified"} ▸
      </span>
    </button>
  );
}
