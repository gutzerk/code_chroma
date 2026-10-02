import { forwardRef, type ReactNode } from "react";

export interface RailButtonProps {
  label: string;
  /** Hover text, when it must differ from the accessible name — e.g. explaining a disabled button. */
  tooltip?: string;
  className?: string;
  testId?: string;
  pressed?: boolean;
  /** For a disclosure control (e.g. a dropdown trigger) rather than a toggle button. */
  ariaExpanded?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** One icon-only left-rail control with a PyCharm-style hover label. The tooltip is a real element
 * rather than a `title` attribute (native tooltips are ~1s late and OS-styled) and is aria-hidden,
 * since `label` already names the button. Forwards its ref so a caller (e.g. a dropdown) can return
 * focus to the trigger on close. */
export const RailButton = forwardRef<HTMLButtonElement, RailButtonProps>(function RailButton(
  { label, tooltip, className, testId, pressed, ariaExpanded, disabled, onClick, children },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      data-testid={testId}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={ariaExpanded}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span className="rail-tooltip" aria-hidden="true">
        {tooltip ?? label}
      </span>
    </button>
  );
});
