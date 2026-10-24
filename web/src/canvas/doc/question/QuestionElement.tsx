import { useMemo } from "react";
import type { CanvasElement } from "../../../state/types";
import { ConnectedQuestionCard } from "./ConnectedQuestionCard";
import { toQuestionView } from "./questionAdapter";

const DEFAULT_WIDTH = 620;

export interface QuestionElementProps {
  element: CanvasElement;
}

/** Canvas-doc renderer for a `question` element; the bridge's "canvas" ping refreshes it after a write. */
export function QuestionElement({ element }: QuestionElementProps) {
  const width = element.size?.w ?? DEFAULT_WIDTH;
  const question = useMemo(() => toQuestionView(element), [element]);

  return (
    <div
      className="question-element"
      data-testid="question-element"
      data-canvas-element
      style={{ position: "absolute", left: element.position.x - width / 2, top: element.position.y, width }}
    >
      <ConnectedQuestionCard question={question} />
    </div>
  );
}
