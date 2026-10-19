import type { QuestionOption } from "./questionAdapter";
import { rankTier } from "./questionAdapter";
import { QUESTION_STRINGS as S } from "./questionStrings";

export interface QuestionOptionsProps {
  options: QuestionOption[];
  disabled?: boolean;
  onChoose: (optionId: string) => void;
}

const TIER_LABEL = { best: S.tierBest, middle: S.tierMiddle, last: S.tierLast };

/** The option cards: title, description, coloured pro/con, AI rank border + recommended badge. */
export function QuestionOptions({ options, disabled, onChoose }: QuestionOptionsProps) {
  if (options.length === 0) return null;
  return (
    <div className="question-options" data-testid="question-options">
      {options.map((option) => {
        const tier = rankTier(option, options);
        return (
          <button
            key={option.id}
            type="button"
            className={`question-option${tier ? ` question-option--${tier}` : ""}`}
            data-testid={`question-option-${option.id}`}
            data-tier={tier ?? undefined}
            disabled={disabled}
            onClick={() => onChoose(option.id)}
          >
            {tier === "best" && <span className="question-option-badge">{S.recommended}</span>}
            <b className="question-option-title">{option.title}</b>
            {option.description && <span className="question-option-desc">{option.description}</span>}
            {option.pro && (
              <span className="question-option-pro">
                <strong>{S.pro}</strong> {option.pro}
              </span>
            )}
            {option.con && (
              <span className="question-option-con">
                <strong>{S.con}</strong> {option.con}
              </span>
            )}
            {option.diagramRef && (
              <span className="question-option-diagram">{S.linkedDiagram(option.diagramRef)}</span>
            )}
            {tier && option.why && (
              <span className="question-option-why">
                {TIER_LABEL[tier]} — {option.why}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
