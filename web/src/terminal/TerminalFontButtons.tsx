import { TERMINAL_FONT_MAX, TERMINAL_FONT_MIN, terminalFontStore, useTerminalFontSize } from "./terminalFontStore";

/** A−/A+ in an agent window's header: the terminal text size for this display (Cmd/Ctrl+= / − / 0 do the same). */
export function TerminalFontButtons() {
  const size = useTerminalFontSize();
  return (
    <span className="terminal-font-buttons" role="group" aria-label={`Terminal text size ${size}px`}>
      <button
        type="button"
        className="agent-window-button terminal-font-button"
        aria-label="Smaller terminal text"
        title={`Smaller terminal text (${size}px)`}
        disabled={size <= TERMINAL_FONT_MIN}
        onClick={() => terminalFontStore.step(-1)}
      >
        A−
      </button>
      <button
        type="button"
        className="agent-window-button terminal-font-button"
        aria-label="Larger terminal text"
        title={`Larger terminal text (${size}px)`}
        disabled={size >= TERMINAL_FONT_MAX}
        onClick={() => terminalFontStore.step(1)}
      >
        A+
      </button>
    </span>
  );
}
