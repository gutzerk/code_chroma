import type { CanvasDoc, DiagramTypeSummary } from "../../state/types";
import { BUILTIN_RECIPES, labelForDiagramLayer } from "./diagramCatalog";
import { BLOCK_RULES } from "./elementRules";
import { stringMeta } from "./elementMeta";
import { groupColorIndex } from "./groupColor";

/** Hex values of styles.css's `canvas-diagram-frame-color-<n>` rules, by index; a test keeps them in sync. */
export const DIAGRAM_HASHED_COLORS = ["#f43f5e", "#06b6d4", "#a3e635", "#fde047", "#818cf8", "#e879f9"] as const;

/** Builtin layers that own a named token colour (styles.css `canvas-diagram-frame-<name>`). */
const TOKEN_LAYERS = new Set(["system-context", "patterns", "impact", "epics"]);

/** The colour token a layer reads when it is not named after the layer (System context keeps `--c1`). */
const TOKEN_VARS: Record<string, string> = { "system-context": "c1" };

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
    return { className: `canvas-diagram-frame-${layer}`, color: `var(--${TOKEN_VARS[layer] ?? layer})` };
  }
  const index = groupColorIndex(layer);
  return { className: `canvas-diagram-frame-color-${index}`, color: DIAGRAM_HASHED_COLORS[index] };
}

export interface DiagramDisplay {
  /** The agent-authored `title` when the diagram has one, else the layer's type label. */
  name: string;
  typeLabel: string;
  boxCount: number;
  /** Whether `name` came from the diagram's own `title` (so the type label adds information). */
  titled: boolean;
}

/** The element meta key the bridge stamps a diagram's top-level `title` under (`recipes.py`'s `DIAGRAM_TITLE_KEY`). */
export const DIAGRAM_TITLE_META = "diagram_title";

const TYPE_LABELS: Record<string, string> = {
  "system-context": "System context",
  patterns: "Patterns",
  impact: "Impact",
  epics: "Epics",
  sequence: "Sequence",
  walkthrough: "Walkthrough",
};

function typeLabelFor(layer: string, customTypes: DiagramTypeSummary[]): string {
  if (TYPE_LABELS[layer]) return TYPE_LABELS[layer];
  if (layer.startsWith("epics/")) return "Epics";
  if (layer.startsWith("feature-plan/")) return "Feature plan";
  if (layer.startsWith("decisions/")) return "Decision";
  return customTypes.find((type) => `custom/${type.id}` === layer)?.title ?? "Custom";
}

/** The diagram's authored title, read off the first element on `layer` that carries one. */
export function diagramTitle(layer: string, doc: CanvasDoc): string | undefined {
  for (const element of Object.values(doc.elements)) {
    if (element.layer !== layer) continue;
    const title = stringMeta(element, DIAGRAM_TITLE_META)?.trim();
    if (title) return title;
  }
  return undefined;
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
      !["group", "note"].includes(BLOCK_RULES[element.render]?.renderer ?? ""),
  ).length;
  const title = diagramTitle(layer, doc);
  return {
    name: title ?? labelForDiagramLayer(layer, customTypes, doc),
    typeLabel: typeLabelFor(layer, customTypes),
    boxCount,
    titled: title !== undefined,
  };
}
