import type { QuestionOption } from "./questionAdapter";
import { rankTier } from "./questionAdapter";
import { QUESTION_STRINGS as S } from "./questionStrings";

export type QuestionVariant = "compact" | "full";

export interface QuestionOptionsProps {
  options: QuestionOption[];
  selectedId: string | null;
  variant?: QuestionVariant;
  disabled?: boolean;
  onSelect: (optionId: string) => void;
}

/** The option tiles as a radiogroup: a click only selects, the card's Send button confirms. */
export function QuestionOptions({ options, selectedId, variant = "compact", disabled, onSelect }: QuestionOptionsProps) {
  if (options.length === 0) return null;
  return (
    <div className="question-options" role="radiogroup" aria-label={S.optionsLabel} data-testid="question-options">
      {options.map((option, index) => {
        const tier = rankTier(option, options);
        const selected = option.id === selectedId;
        const expanded = variant === "full" || selected;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (selectedId === null && index === 0) ? 0 : -1}
            className="question-option"
            data-testid={`question-option-${option.id}`}
            data-tier={tier ?? undefined}
            disabled={disabled}
            onClick={() => onSelect(option.id)}
          >
            <span className="question-option-head">
              <span className="question-option-num" aria-hidden="true">{index + 1}</span>
              <b className="question-option-title">{option.title}</b>
              {tier === "best" && (
                <span className="question-option-badge" title={option.why || undefined}>{S.recommended}</span>
              )}
              {variant === "compact" && !selected && <span className="question-option-chevron" aria-hidden="true">›</span>}
            </span>
            {expanded && option.description && <span className="question-option-desc">{option.description}</span>}
            {expanded && (option.pro || option.con) && (
              <span className="question-option-chips">
                {option.pro && <span className="question-chip question-chip--pro">✓ {option.pro}</span>}
                {option.con && <span className="question-chip question-chip--con">✕ {option.con}</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
