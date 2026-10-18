import { useState } from "react";
import { DecisionHistory } from "./DecisionHistory";
import type { QuestionView } from "./questionAdapter";
import { QuestionOptions } from "./QuestionOptions";
import { QUESTION_STRINGS as S } from "./questionStrings";

export interface QuestionCardProps {
  question: QuestionView;
  history: QuestionView[];
  busy?: boolean;
  error?: string | null;
  onChooseOption: (optionId: string) => void;
  onCustomAnswer: (text: string) => void;
  onSkip: () => void;
  onRevise: (question: QuestionView) => void;
}

/** One agent question: progress, title, option cards, custom answer, skip, history and revise. */
export function QuestionCard({
  question, history, busy, error, onChooseOption, onCustomAnswer, onSkip, onRevise,
}: QuestionCardProps) {
  const [draft, setDraft] = useState("");
  const { step, total } = question;

  if (question.state !== "open") {
    return (
      <div className="question-card question-card--done" data-testid="question-card" data-state={question.state}>
        <small>{S.decisionRecorded}</small>
        <h3 className="question-title">{question.title}</h3>
        <p className="question-result">
          {question.state === "skipped" ? S.skipped : `✓ ${question.answer ?? ""}`}
        </p>
        <button type="button" className="question-quiet" disabled={busy} onClick={() => onRevise(question)}>
          {S.changeAnswer}
        </button>
      </div>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onCustomAnswer(text);
  };

  return (
    <div className="question-card" data-testid="question-card" data-state="open">
      <small>
        {S.agentAsks}
        {step !== null && total !== null ? ` · ${S.progress(step, total)}` : ""}
      </small>
      {step !== null && total !== null && total > 0 && (
        <div
          className="question-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={step - 1}
        >
          <div className="question-progress-bar" style={{ width: `${((step - 1) / total) * 100}%` }} />
        </div>
      )}
      <h3 className="question-title">{question.title}</h3>
      <QuestionOptions options={question.options} disabled={busy} onChoose={onChooseOption} />
      {question.allowCustom && (
        <form className="question-custom" onSubmit={submit}>
          <input
            aria-label={S.customLabel}
            placeholder={S.customPlaceholder}
            maxLength={300}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="question-quiet" disabled={busy || !draft.trim()}>
            {S.customSubmit}
          </button>
        </form>
      )}
      {question.allowSkip && (
        <button type="button" className="question-quiet" disabled={busy} onClick={onSkip}>
          {S.skip}
        </button>
      )}
      {error && <p className="question-error" role="alert">{error}</p>}
      {history.length > 0 && <DecisionHistory items={history} disabled={busy} onRevise={onRevise} />}
    </div>
  );
}
