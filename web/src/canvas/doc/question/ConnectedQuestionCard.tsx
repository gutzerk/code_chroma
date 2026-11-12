import { useMemo, useState } from "react";
import type { CanvasDoc } from "../../../state/types";
import { reportAsyncError } from "../../../util/reportError";
import { sessionHistory, type QuestionView } from "./questionAdapter";
import { answerCustom, answerOption, chatQuestion, requestDiagram, reviseQuestion, skipQuestion, type QuestionActions } from "./questionClient";
import { QuestionCard } from "./QuestionCard";
import type { QuestionVariant } from "./QuestionOptions";
import { QUESTION_STRINGS as S } from "./questionStrings";

export interface ConnectedQuestionCardProps {
  question: QuestionView;
  /** Where answers post: the agent-scoped routes in the agent window. */
  client: QuestionActions;
  /** The doc the question came from, for its session history. */
  doc: CanvasDoc;
  variant?: QuestionVariant;
  selectedId?: string | null;
  onSelectedIdChange?: (optionId: string) => void;
  onReturnFocus?: () => void;
}

/** A QuestionCard wired to the bridge: answer, skip, chat and revise for one `question` element. */
export function ConnectedQuestionCard({ question, client, doc, variant, selectedId, onSelectedIdChange, onReturnFocus }: ConnectedQuestionCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const history = useMemo(() => sessionHistory(doc.elements, question), [doc.elements, question]);

  /** Runs one question write; resolves true when it succeeded. */
  const run = (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    return action()
      .then(() => true)
      .catch((cause: unknown) => {
        setError(S.failed);
        reportAsyncError("question answer", cause);
        return false;
      })
      .finally(() => setBusy(false));
  };

  return (
    <QuestionCard
      question={question}
      history={history}
      variant={variant}
      selectedId={selectedId}
      onSelectedIdChange={onSelectedIdChange}
      onReturnFocus={onReturnFocus}
      busy={busy}
      error={error}
      onChooseOption={(id) => run(() => answerOption(client, question, id))}
      onCustomAnswer={(text) => run(() => answerCustom(client, question, text))}
      onSkip={() => run(() => skipQuestion(client, question))}
      onRevise={(q: QuestionView) => run(() => reviseQuestion(client, q))}
      onRequestDiagram={() => run(() => requestDiagram(client, question))}
      // Focus moves to the terminal only once the question is closed, so a failure stays visible on the card.
      onChat={() => void run(() => chatQuestion(client, question)).then((ok) => ok && onReturnFocus?.())}
    />
  );
}
