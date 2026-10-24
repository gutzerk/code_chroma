export type QuestionLayout = "A2" | "A4" | "B1";

const B1_MIN_WIDTH = 1100;
const A4_MIN_WIDTH = 880;

/** Which question layout fits the agent host: B1 split (full mode, wide), A4 diagram pane, else A2 compact card. */
export function pickQuestionLayout({ width, full, hasDiagram }: { width: number; full: boolean; hasDiagram: boolean }): QuestionLayout {
  if (full && width >= B1_MIN_WIDTH) return "B1";
  if (hasDiagram && width >= A4_MIN_WIDTH) return "A4";
  return "A2";
}
