import type { ReactNode } from "react";
import { ModalDialog } from "../agents/ModalDialog";
import { PanelCloseButton } from "../canvas/PanelCloseButton";

/** A floating window over the canvas for one game — a thin ModalDialog wrapper (portal, focus
 * trap, Escape-to-close) with a title bar plus minimize/close buttons, no drag/resize since a
 * small game never needs AgentWindow's extra machinery.
 *
 * Minimizing must not unmount `children` — that would reset the running game — so a minimized
 * window renders the same children in a plain hidden `<div>` instead of skipping them. Only
 * closing (×) actually drops the game state. */
export function GameWindow({
  title,
  minimized,
  onMinimize,
  onDismiss,
  children,
}: {
  title: string;
  minimized: boolean;
  onMinimize: () => void;
  onDismiss: () => void;
  children: ReactNode;
}) {
  if (minimized) {
    return (
      <div className="game-window-minimized" data-testid="game-window-minimized" aria-hidden="true">
        {children}
      </div>
    );
  }

  return (
    <ModalDialog label={title} testId="game-window" className="game-window" onDismiss={onDismiss}>
      <header className="game-window-header">
        <h2>{title}</h2>
        <div className="game-window-actions">
          <button
            type="button"
            className="game-window-minimize"
            data-testid="game-window-minimize"
            aria-label="Minimize"
            onClick={onMinimize}
          >
            &#8211;
          </button>
          <PanelCloseButton
            className="game-window-close"
            testId="game-window-close"
            ariaLabel="Close"
            onClick={onDismiss}
          />
        </div>
      </header>
      {children}
    </ModalDialog>
  );
}
