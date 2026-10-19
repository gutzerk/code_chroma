import type { CanvasDoc, DiagramTypeSummary } from "../../state/types";
import { BUILTIN_RECIPES, labelForDiagramLayer } from "./diagramCatalog";
import { BLOCK_RULES } from "./elementRules";
import { groupColorIndex } from "./groupColor";

/** Hex values of styles.css's `canvas-diagram-frame-color-<n>` rules, by index; a test keeps them in sync. */
export const DIAGRAM_HASHED_COLORS = ["#f43f5e", "#06b6d4", "#a3e635", "#fde047", "#818cf8", "#e879f9"] as const;

/** Builtin layers that own a named token colour (styles.css `canvas-diagram-frame-<name>`). */
const TOKEN_LAYERS = new Set(["c1", "patterns", "impact", "epics"]);

export interface DiagramAccent {
  /** The frame's CSS class (`canvas-diagram-frame-<name>` or `canvas-diagram-frame-color-<n>`). */
  className: string;
  /** A concrete CSS colour (`var(--c1)` or a hex) for the list-row dot. */
  color: string;
}

/** The single colour source for a diagram layer, shared by the frame border and the list-row dot. */
export function diagramAccent(layer: string): DiagramAccent {
  const builtin = BUILTIN_RECIPES.some((recipe) => recipe.name === layer);
  if (builtin && TOKEN_LAYERS.has(layer)) {
    return { className: `canvas-diagram-frame-${layer}`, color: `var(--${layer})` };
  }
  if (builtin) {
    const index = groupColorIndex(layer);
    return { className: `canvas-diagram-frame-${layer}`, color: DIAGRAM_HASHED_COLORS[index] };
  }
  const index = groupColorIndex(layer);
  return { className: `canvas-diagram-frame-color-${index}`, color: DIAGRAM_HASHED_COLORS[index] };
}

export interface DiagramDisplay {
  name: string;
  typeLabel: string;
  boxCount: number;
}

const TYPE_LABELS: Record<string, string> = {
  c1: "C1",
  patterns: "Patterns",
  impact: "Impact",
  epics: "Epics",
  sequence: "Sequence",
};

function typeLabelFor(layer: string): string {
  if (TYPE_LABELS[layer]) return TYPE_LABELS[layer];
  if (layer.startsWith("epics/")) return "Epics";
  return "Custom";
}

/** Name, short type label and box count of one diagram layer, for list rows and frame headers. */
export function diagramDisplayName(
  layer: string,
  doc: CanvasDoc,
  customTypes: DiagramTypeSummary[] = [],
): DiagramDisplay {
  const boxCount = Object.values(doc.elements).filter(
    (element) =>
      element.layer === layer &&
      !["group", "note"].includes(BLOCK_RULES[element.render].renderer),
  ).length;
  return { name: labelForDiagramLayer(layer, customTypes, doc), typeLabel: typeLabelFor(layer), boxCount };
}
