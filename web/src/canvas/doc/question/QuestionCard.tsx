import { useState } from "react";
import { DecisionHistory } from "./DecisionHistory";
import { resolveSelection, type QuestionView } from "./questionAdapter";
import { QuestionOptions, type QuestionVariant } from "./QuestionOptions";
import { QUESTION_STRINGS as S } from "./questionStrings";

export interface QuestionCardProps {
  question: QuestionView;
  history: QuestionView[];
  variant?: QuestionVariant;
  busy?: boolean;
  error?: string | null;
  onChooseOption: (optionId: string) => void;
  onCustomAnswer: (text: string) => void;
  onSkip: () => void;
  onRevise: (question: QuestionView) => void;
  /** Asks the agent to add a diagram to every option that lacks one. */
  onRequestDiagram?: () => void;
  /** Controlled highlighted option (a host shares it with the diagram); leave unset for the card to own it. */
  selectedId?: string | null;
  /** Called with the new highlighted option when the user picks one. */
  onSelectedIdChange?: (optionId: string) => void;
  /** Hands focus back to the agent terminal (after an answer, Shift+Tab, Ctrl+Enter). */
  onReturnFocus?: () => void;
}

/** One agent question: progress, title, selectable option tiles, custom answer, Send, skip and history. */
export function QuestionCard({
  question, history, variant = "full", busy, error, onChooseOption, onCustomAnswer, onSkip, onRevise, onRequestDiagram,
  selectedId: controlledId, onSelectedIdChange, onReturnFocus,
}: QuestionCardProps) {
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [ownPick, setOwnPick] = useState<string | null>(null);
  const selectedId = resolveSelection(question, controlledId === undefined ? ownPick : controlledId);
  const setSelectedId = (id: string) => {
    setOwnPick(id);
    onSelectedIdChange?.(id);
  };
  const { step, total } = question;
  const progress = step !== null && total !== null ? { step, total } : null;

  if (question.state !== "open") {
    const result = question.state === "skipped" ? S.skipped : question.answer ?? "";
    return (
      <div className="question-card question-card--done" data-testid="question-card" data-state={question.state}>
        <p className="question-result">{S.answeredRow(question.step, question.title, result)}</p>
        <button type="button" className="question-quiet" disabled={busy} onClick={() => onRevise(question)}>
          {S.change}
        </button>
      </div>
    );
  }

  const text = draft.trim();
  const canSend = !busy && (text !== "" || selectedId !== null);

  const send = () => {
    if (!canSend) return;
    if (text) {
      setDraft("");
      onCustomAnswer(text);
    } else if (selectedId) {
      onChooseOption(selectedId);
    }
    onReturnFocus?.();
  };

  const move = (delta: number) => {
    const ids = question.options.map((o) => o.id);
    if (ids.length === 0) return;
    const at = selectedId === null ? -1 : ids.indexOf(selectedId);
    setSelectedId(ids[Math.min(ids.length - 1, Math.max(0, at + delta))]);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const inInput = event.target instanceof HTMLInputElement;
    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      onReturnFocus?.();
    } else if (event.key === "Tab" && event.shiftKey && onReturnFocus) {
      event.preventDefault();
      onReturnFocus();
    } else if (event.key === "Escape" && question.allowSkip && !busy) {
      event.preventDefault();
      onSkip();
      onReturnFocus?.();
    } else if (inInput) {
      return;
    } else if (/^[1-9]$/.test(event.key)) {
      const option = question.options[Number(event.key) - 1];
      if (option) setSelectedId(option.id);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && !(event.target as HTMLElement).classList.contains("question-quiet")) {
      event.preventDefault();
      send();
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    send();
  };

  const lacksDiagram = question.options.some((o) => !o.diagramRef);
  const canRequestDiagram = onRequestDiagram !== undefined && lacksDiagram && question.diagramRequests < 2;

  const lastAnswer = history.length > 0 ? history[history.length - 1] : null;

  return (
    <div
      className={`question-card question-card--${variant}`}
      data-testid="question-card"
      data-state="open"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="question-header">
        <span className="question-avatar" aria-hidden="true">?</span>
        <span>{progress ? S.progress(progress.step, progress.total) : S.agentAsks}</span>
        <span className="question-header-gap" />
        {progress && progress.total > 0 && (
          <span
            className="question-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.step - 1}
          >
            {Array.from({ length: Math.min(progress.total, 8) }, (_, i) => (
              <span key={i} className={`question-progress-seg${i < progress.step ? " question-progress-seg--on" : ""}`} />
            ))}
          </span>
        )}
      </div>
      <h3 className="question-title">{question.title}</h3>
      <QuestionOptions
        options={question.options}
        selectedId={selectedId}
        variant={variant}
        disabled={busy}
        onSelect={setSelectedId}
      />
      {(question.allowCustom || question.options.length > 0) && (
        <form className="question-custom" onSubmit={submit}>
          {question.allowCustom && (
            <input
              aria-label={S.customLabel}
              placeholder={S.customPlaceholder}
              maxLength={300}
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
          <button type="submit" className="question-send" disabled={!canSend}>
            {S.send}
          </button>
        </form>
      )}
      {error && <p className="question-error" role="alert">{error}</p>}
      <div className="question-footer">
        {lastAnswer ? (
          <button type="button" className="question-quiet" onClick={() => setShowHistory((v) => !v)}>
            {S.earlier(lastAnswer.state === "skipped" ? S.skipped : lastAnswer.answer ?? "")} · {S.change}
          </button>
        ) : (
          <span />
        )}
        <span className="question-footer-actions">
        {canRequestDiagram && (
          <button
            type="button"
            className="question-quiet"
            disabled={busy || question.diagramRequested}
            onClick={onRequestDiagram}
          >
            {question.diagramRequested ? S.diagramRequested : S.addDiagram}
          </button>
        )}
        {question.allowSkip && (
          <button type="button" className="question-quiet" disabled={busy} onClick={onSkip}>
            {S.skip}
          </button>
        )}
        </span>
      </div>
      {showHistory && history.length > 0 && <DecisionHistory items={history} disabled={busy} onRevise={onRevise} />}
    </div>
  );
}
