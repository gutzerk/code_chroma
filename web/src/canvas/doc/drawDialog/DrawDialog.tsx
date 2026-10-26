import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { attachAgent } from "../../../agents/attachAgent";
import { useAgentClient } from "../../../agents/AgentClientContext";
import { agentStore, useIsAtAgentCapacity, useIsLaunchingAgent, useMaxAgents } from "../../../agents/agentStore";
import { DiagramKindCard } from "./DiagramKindCard";
import { drawDialogStore, useDrawDialog } from "./drawDialogStore";
import { useDiagramKinds, type DrawCard } from "./useDiagramKinds";
import "./DrawDialog.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const GRID_COLUMNS = 4;

/** The first message a draw agent gets when the bridge does not replace it with the composed skill prompt. */
function taskFor(card: DrawCard): string {
  return card.type === "any"
    ? "Draw a diagram of this project using the codechroma-draw-diagram skill."
    : `Draw a ${card.name.toLowerCase()} diagram of this project using the codechroma-draw-diagram skill.`;
}

/** A saved type is named in the request so the agent draws that type; the user's own words follow it. */
function requestFor(card: DrawCard, prompt: string): string {
  if (!card.customTypeId) return prompt;
  return `Use the saved diagram type "${card.customTypeId}". ${prompt}`.trim();
}

/**
 * The "Draw…" dialog: pick a diagram type, say what it should show (scope included, in your own
 * words), and one agent opens already knowing both. Rendered inside the canvas stage so the rail and
 * Agents panel stay visible; Esc, Cancel, the close button or the scrim close it.
 */
export function DrawDialog() {
  const { open } = useDrawDialog();
  return open ? <DrawDialogBody /> : null;
}

function DrawDialogBody() {
  const agentClient = useAgentClient();
  const { cardId, prompt } = useDrawDialog();
  const { cards, loading, error: loadError } = useDiagramKinds(true);
  const isAtCapacity = useIsAtAgentCapacity();
  const isLaunching = useIsLaunchingAgent();
  const maxAgents = useMaxAgents();
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const card = cards.find((c) => c.id === cardId) ?? cards.find((c) => c.id === "any") ?? cards[0];
  const blockedReason = isAtCapacity
    ? `${maxAgents} agents is the limit — close one to start another`
    : isLaunching
      ? "Launching…"
      : undefined;
  const canDraw = card !== undefined && !blockedReason;

  const draw = async () => {
    if (!card || blockedReason) return;
    setError(null);
    const before = new Set(agentStore.getAgents().map((a) => a.id));
    const text = prompt.trim();
    await attachAgent(agentClient, null, taskFor(card), {
      type: card.type,
      request: requestFor(card, text) || undefined,
      title: `Draw · ${card.name}`,
    });
    const failure = agentStore.getLaunchError();
    if (failure) setError(failure);
    else if (agentStore.getAgents().some((a) => !before.has(a.id))) drawDialogStore.drawn();
    // No agent and no error: the launch was parked behind another prompt (git setup); keep the draft.
    else drawDialogStore.close();
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    promptRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        drawDialogStore.close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = dialogRef.current?.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreTo?.focus?.();
    };
  }, []);

  const onCardKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!card) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void drawRef.current();
      return;
    }
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1
        : event.key === "ArrowDown" ? GRID_COLUMNS : event.key === "ArrowUp" ? -GRID_COLUMNS : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = cards[cards.findIndex((c) => c.id === card.id) + step];
    if (!next) return;
    drawDialogStore.pick(next.id);
    requestAnimationFrame(() =>
      dialogRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(next.id)}"]`)?.focus(),
    );
  };

  return (
    <div
      className="draw-scrim"
      data-testid="draw-dialog-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) drawDialogStore.close();
      }}
    >
      <div
        ref={dialogRef}
        className="draw-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Draw a diagram"
        data-testid="draw-dialog"
      >
        <header className="draw-dialog-head">
          <div>
            <div className="draw-dialog-eyebrow">DRAW A DIAGRAM</div>
            <h2>What should the agent draw?</h2>
            <p>Pick a type, say what to focus on. An agent draws it on the canvas.</p>
          </div>
          <button type="button" className="draw-dialog-close" aria-label="Close" onClick={drawDialogStore.close}>
            ×
          </button>
        </header>

        {loadError ? (
          <p className="draw-dialog-error" role="alert">{loadError}</p>
        ) : (
          <div className="draw-grid" role="radiogroup" aria-label="Diagram type" aria-busy={loading}>
            {cards.map((c) => (
              <DiagramKindCard
                key={c.id}
                card={c}
                selected={c.id === card?.id}
                onPick={() => drawDialogStore.pick(c.id)}
                onKeyDown={onCardKeyDown}
              />
            ))}
          </div>
        )}

        <div className="draw-prompt">
          <label htmlFor="draw-dialog-prompt">
            What should it show?
            {card && <span className="draw-prompt-kind"> · {card.name.toUpperCase()}</span>}
          </label>
          <textarea
            id="draw-dialog-prompt"
            ref={promptRef}
            rows={3}
            value={prompt}
            placeholder={card?.placeholder}
            data-testid="draw-dialog-prompt"
            onChange={(event) => drawDialogStore.setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void draw();
              }
            }}
          />
        </div>

        <footer className="draw-dialog-foot">
          <span className="draw-dialog-hint">
            Opens a new agent in the Agents panel · <kbd>Enter</kbd> to draw
          </span>
          {error && <span className="draw-dialog-error" role="alert" data-testid="draw-dialog-error">{error}</span>}
          <div className="draw-dialog-actions">
            <button type="button" className="draw-btn" onClick={drawDialogStore.close}>Cancel</button>
            <button
              type="button"
              className="draw-btn draw-btn--primary"
              data-testid="draw-dialog-submit"
              disabled={!canDraw}
              title={blockedReason}
              onClick={() => void draw()}
            >
              Draw with agent
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
