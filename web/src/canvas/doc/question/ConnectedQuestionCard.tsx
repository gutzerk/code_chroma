import { useMemo, useState } from "react";
import { useOptionalAgentClient } from "../../../agents/AgentClientContext";
import { restoreAgentWindow } from "../../../agents/windowActions";
import { useEngineClient } from "../../../engine-client/EngineClientContext";
import { layoutStore } from "../../layout/layoutStore";
import { reportAsyncError } from "../../../util/reportError";
import { useCanvasDoc } from "../canvasDocStore";
import { sessionHistory, type QuestionView } from "./questionAdapter";
import { answerCustom, answerOption, requestDiagram, reviseQuestion, skipQuestion } from "./questionClient";
import { QuestionCard } from "./QuestionCard";
import type { QuestionVariant } from "./QuestionOptions";
import { QUESTION_STRINGS as S } from "./questionStrings";

export interface ConnectedQuestionCardProps {
  question: QuestionView;
  variant?: QuestionVariant;
  selectedId?: string | null;
  onSelectedIdChange?: (optionId: string) => void;
  onReturnFocus?: () => void;
}

/** A QuestionCard wired to the bridge: answer, skip and revise for one `question` element. */
export function ConnectedQuestionCard({ question, variant, selectedId, onSelectedIdChange, onReturnFocus }: ConnectedQuestionCardProps) {
  const client = useEngineClient();
  const doc = useCanvasDoc();
  const agentClient = useOptionalAgentClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const { agentId } = question;
  const chat = agentClient && agentId
    ? () => {
        layoutStore.setAgentsMode("full");
        restoreAgentWindow(agentClient, agentId);
      }
    : undefined;

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
      onChat={chat}
    />
  );
}
