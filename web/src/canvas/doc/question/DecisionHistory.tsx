import type { QuestionView } from "./questionAdapter";
import { QUESTION_STRINGS as S } from "./questionStrings";

export interface DecisionHistoryProps {
  items: QuestionView[];
  disabled?: boolean;
  onRevise: (question: QuestionView) => void;
}

/** The session's earlier decisions, each with a Revise button. */
export function DecisionHistory({ items, disabled, onRevise }: DecisionHistoryProps) {
  return (
    <div className="question-history" data-testid="question-history" aria-live="polite">
      <small>{S.historyTitle}</small>
      {items.length === 0 ? (
        <p>{S.historyEmpty}</p>
      ) : (
        <>
          {items.map((item, index) => (
            <p key={item.elementId} data-testid="question-history-item">
              <b>
                {item.step ?? index + 1}. {item.title}
              </b>
              <br />
              {item.state === "skipped" ? S.skipped : item.answer}{" "}
              <button
                type="button"
                className="question-quiet"
                disabled={disabled}
                aria-label={`${S.revise} ${item.step ?? index + 1}`}
                onClick={() => onRevise(item)}
              >
                {S.revise}
              </button>
            </p>
          ))}
          <p className="question-note">{S.reviseNote}</p>
        </>
      )}
    </div>
  );
}
