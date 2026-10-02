import type { EpicStage, EpicStageSection } from "../../state/types";

/** The stage/section id/label helpers `SpecsFrame` shares with the old box-graph walk — split out
 * of `epicsGraph.ts` (deleted with `EpicsView.tsx`, 016-single-canvas-dashboard Stage 4) since
 * `SpecsFrame` needs only these pure id/label builders, never the dagre node/edge walk itself. */

export function stageNodeId(featureName: string, kind: string): string {
  return `epic-stage::${featureName}::${kind}`;
}

export function sectionNodeId(featureName: string, kind: string, index: number): string {
  return `epic-stage-section::${featureName}::${kind}::${index}`;
}

/** Toggles one id in an expanded-node Set, firing `onExpand` only on the add branch. */
export function toggleExpanded(
  nodeId: string,
  expanded: ReadonlySet<string>,
  setExpanded: (update: (previous: ReadonlySet<string>) => ReadonlySet<string>) => void,
  onExpand?: () => void,
): void {
  if (expanded.has(nodeId)) {
    setExpanded((previous) => {
      const next = new Set(previous);
      next.delete(nodeId);
      return next;
    });
    return;
  }
  setExpanded((previous) => new Set(previous).add(nodeId));
  onExpand?.();
}

const STAGE_LABELS: Record<string, string> = {
  spec: "Spec",
  plan: "Plan",
  tasks: "Tasks",
  research: "Research",
  "data-model": "Data model",
  quickstart: "Quickstart",
};

function stageLabel(kind: string): string {
  if (kind in STAGE_LABELS) return STAGE_LABELS[kind];
  if (kind.startsWith("contract-")) return `Contract · ${kind.slice("contract-".length)}`;
  if (kind.startsWith("checklist-")) return `Checklist · ${kind.slice("checklist-".length)}`;
  return kind;
}

export function stageHeader(stage: EpicStage): string {
  if (stage.total !== null) {
    return `${stageLabel(stage.kind)} ${stage.total}`;
  }
  return stage.status ? `${stageLabel(stage.kind)} — ${stage.status}` : stageLabel(stage.kind);
}

export function sectionHeader(section: EpicStageSection): string {
  if (section.total !== null && section.done !== null) {
    return `${section.title} ${section.done}/${section.total}`;
  }
  return section.title;
}
