import type { CollapseKind } from "./impactGlanceLogic";
import { impactExpandStore, useMergedPills, MERGED_PILL_HEIGHT } from "./impactBoxState";
import { useCanvasDoc } from "./canvasDocStore";

/** A collapsed Impact box: a quiet pill naming it, opened in place by a click.
 *
 * Minor modified boxes of one group share a single "N more modified" pill (drawn by the group's
 * leader, with the file names as a mono second line); the other members draw nothing. */
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
  const doc = useCanvasDoc();
  const group = useMergedPills(doc).get(elementId);
  if (group && group.leader !== elementId) return null;
  if (group) {
    const names = group.names.join(" · ");
    return (
      <button
        type="button"
        className="impact-pill impact-pill--merged"
        data-testid="impact-pill"
        data-impact-pill="minor-merged"
        data-select-id={elementId}
        style={{ position: "absolute", left, top: top + 17 - MERGED_PILL_HEIGHT / 2, width }}
        onClick={() => impactExpandStore.expandAll(group.members)}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="impact-pill-label">{group.members.length} more modified {"▸"}</span>
        <span className="impact-pill-files" title={names}>
          {names}
        </span>
      </button>
    );
  }
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
        {label} {"·"} {collapse === "unchanged" ? "unchanged" : "modified"} {"▸"}
      </span>
    </button>
  );
}
