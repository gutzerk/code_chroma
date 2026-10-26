import { useEffect, useState } from "react";
import type { Run, RunMessage } from "./types";
import { workflowStore, useHighlightedNodeId, type WorkflowActions } from "./workflowStore";

const RING_CLASS = "workflow-canvas-ring";

/** Rings the highlighted canvas node (the purple ~1.6s ring) for as long as the store holds it. */
function useCanvasRing(): void {
  const nodeId = useHighlightedNodeId();
  useEffect(() => {
    if (!nodeId) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`));
    els.forEach((el) => el.classList.add(RING_CLASS));
    return () => els.forEach((el) => el.classList.remove(RING_CLASS));
  }, [nodeId]);
}

function MessageLine({ message }: { message: RunMessage }) {
  if (message.role === "system") {
    return (
      <li className="chat-system" data-testid="chat-system">
        {message.text}
      </li>
    );
  }
  return (
    <li className="chat-message" data-role={message.role} data-target={message.target}>
      <span className="chat-who">
        {message.role === "user" ? "You" : "Agent"}
      </span>
      <span className="chat-text">{message.text}</span>
      {message.chips && message.chips.length > 0 && (
        <span className="chat-chips">
          {message.chips.map((chip) => (
            <span key={chip.nodeId} className="chat-chip" data-testid="chat-chip">
              <span>{chip.label}</span>
              <button
                type="button"
                className="chat-show"
                onClick={() => workflowStore.highlightNode(chip.nodeId)}
              >
                {`Show ${chip.label} on canvas`}
              </button>
            </span>
          ))}
        </span>
      )}
    </li>
  );
}

/** Chat with the run agent (a step's agent is talked to in its terminal), inline system events and canvas chips. */
export function RunChat({
  run,
  actions,
}: {
  run: Run;
  actions: WorkflowActions;
}) {
  const [text, setText] = useState("");
  useCanvasRing();

  const send = (): void => {
    const body = text.trim();
    if (!body) return;
    workflowStore.setRailCollapsed(true);
    setText("");
    void actions.message(run.id, "run", body);
  };

  return (
    <section className="run-chat" aria-label="Run chat" data-testid="run-chat">
      <ul className="chat-log" role="log" aria-label="Chat messages" data-testid="chat-log">
        {(run.messages ?? []).map((m) => (
          <MessageLine key={m.id} message={m} />
        ))}
      </ul>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="chat-input"
          data-testid="chat-input"
          aria-label="Message the run"
          placeholder="Ask the run"
          value={text}
          onFocus={() => workflowStore.setRailCollapsed(true)}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="workflow-header-button" data-testid="chat-send">
          Send
        </button>
      </form>
    </section>
  );
}
