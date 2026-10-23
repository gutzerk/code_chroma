import type { CanvasElement } from "../../../state/types";
import { ConnectedQuestionCard } from "./ConnectedQuestionCard";

const DEFAULT_WIDTH = 620;

export interface QuestionElementProps {
  element: CanvasElement;
}

/** Canvas-doc renderer for a `question` element: positions the card on the canvas.
 * The bridge's "canvas" ping (via useLoadCanvasDoc) refreshes the element after a write. */
export function QuestionElement({ element }: QuestionElementProps) {
  const width = element.size?.w ?? DEFAULT_WIDTH;

  return (
    <div
      className="question-element"
      data-testid="question-element"
      data-canvas-element
      style={{ position: "absolute", left: element.position.x - width / 2, top: element.position.y, width }}
    >
      <ConnectedQuestionCard element={element} />
    </div>
  );
}
