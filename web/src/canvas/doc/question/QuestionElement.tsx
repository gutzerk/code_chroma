import { useMemo, useState } from "react";
import type { CanvasElement } from "../../../state/types";
import { useEngineClient } from "../../../engine-client/EngineClientContext";
import { reportAsyncError } from "../../../util/reportError";
import { useCanvasDoc } from "../canvasDocStore";
import { sessionHistory, toQuestionView, type QuestionView } from "./questionAdapter";
import { answerCustom, answerOption, reviseQuestion, skipQuestion } from "./questionClient";
import { QuestionCard } from "./QuestionCard";
import { QUESTION_STRINGS as S } from "./questionStrings";

const DEFAULT_WIDTH = 620;

export interface QuestionElementProps {
  element: CanvasElement;
}

/** Canvas-doc renderer for a `question` element: positions the card and wires it to the bridge.
 * The bridge's "canvas" ping (via useLoadCanvasDoc) refreshes the element after a write. */
export function QuestionElement({ element }: QuestionElementProps) {
  const client = useEngineClient();
  const doc = useCanvasDoc();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const question = useMemo(() => toQuestionView(element), [element]);
  const history = useMemo(() => sessionHistory(doc.elements, question), [doc.elements, question]);
  const width = element.size?.w ?? DEFAULT_WIDTH;

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    action()
      .catch((cause: unknown) => {
        setError(S.failed);
        reportAsyncError("question answer", cause);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="question-element"
      data-testid="question-element"
      data-canvas-element
      style={{ position: "absolute", left: element.position.x - width / 2, top: element.position.y, width }}
    >
      <QuestionCard
        question={question}
        history={history}
        busy={busy}
        error={error}
        onChooseOption={(id) => run(() => answerOption(client, question, id))}
        onCustomAnswer={(text) => run(() => answerCustom(client, question, text))}
        onSkip={() => run(() => skipQuestion(client, question))}
        onRevise={(q: QuestionView) => run(() => reviseQuestion(client, q))}
      />
    </div>
  );
}
