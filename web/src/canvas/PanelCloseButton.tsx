export interface PanelCloseButtonProps {
  /** The panel's own close-button class -- kept per-caller so each panel's existing CSS is untouched. */
  className: string;
  ariaLabel: string;
  testId?: string;
  onClick: () => void;
}

/** The `×`/`✕` close control every floating panel (Inspector, epic brief, diagram wizard, LLM
 * settings, description/code popups, a game window) repeated by hand with a slightly different
 * glyph each time. One glyph (`✕`), one markup shape; only the class/label/testid vary per panel. */
export function PanelCloseButton({ className, ariaLabel, testId, onClick }: PanelCloseButtonProps) {
  return (
    <button type="button" className={className} aria-label={ariaLabel} data-testid={testId} onClick={onClick}>
      ✕
    </button>
  );
}
