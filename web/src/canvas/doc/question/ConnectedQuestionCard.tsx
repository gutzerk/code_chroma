import { useMemo, useState } from "react";
import type { CanvasElement } from "../../../state/types";
import { useEngineClient } from "../../../engine-client/EngineClientContext";
import { reportAsyncError } from "../../../util/reportError";
import { useCanvasDoc } from "../canvasDocStore";
import { sessionHistory, toQuestionView, type QuestionView } from "./questionAdapter";
import { answerCustom, answerOption, requestDiagram, reviseQuestion, skipQuestion } from "./questionClient";
import { QuestionCard } from "./QuestionCard";
import type { QuestionVariant } from "./QuestionOptions";
import { QUESTION_STRINGS as S } from "./questionStrings";

export interface ConnectedQuestionCardProps {
  element: CanvasElement;
  variant?: QuestionVariant;
  onSelectionChange?: (optionId: string | null) => void;
  onReturnFocus?: () => void;
}

/** A QuestionCard wired to the bridge: answer, skip and revise for one `question` element. */
export function ConnectedQuestionCard({ element, variant, onSelectionChange, onReturnFocus }: ConnectedQuestionCardProps) {
  const client = useEngineClient();
  const doc = useCanvasDoc();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const question = useMemo(() => toQuestionView(element), [element]);
  const history = useMemo(() => sessionHistory(doc.elements, question), [doc.elements, question]);

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
    <QuestionCard
      question={question}
      history={history}
      variant={variant}
      onSelectionChange={onSelectionChange}
      onReturnFocus={onReturnFocus}
      busy={busy}
      error={error}
      onChooseOption={(id) => run(() => answerOption(client, question, id))}
      onCustomAnswer={(text) => run(() => answerCustom(client, question, text))}
      onSkip={() => run(() => skipQuestion(client, question))}
      onRevise={(q: QuestionView) => run(() => reviseQuestion(client, q))}
      onRequestDiagram={() => run(() => requestDiagram(client, question))}
    />
  );
}
