import { useEffect, useState } from "react";
import { parseTarget } from "./redoPlan";
import type { Run, RunMessage, WorkflowDef } from "./types";
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

/** The @-prefix being typed at the end of the input, or null when the picker should be closed. */
function pickerQuery(text: string): string | null {
  const match = /(?:^|\s)@([\w-]*)$/.exec(text);
  return match ? match[1] : null;
}

function MessageLine({ message, workflow }: { message: RunMessage; workflow: WorkflowDef }) {
  const slug = workflow.steps.find((s) => s.id === message.target)?.slug;
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
        {slug ? ` @${slug}` : ""}
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

/** Chat with the run agent (or one step's agent via @slug), inline system events and canvas chips. */
export function RunChat({
  run,
  workflow,
  actions,
}: {
  run: Run;
  workflow: WorkflowDef;
  actions: WorkflowActions;
}) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  useCanvasRing();
  const query = pickerQuery(text);
  const options = query === null ? [] : workflow.steps.filter((s) => s.slug.startsWith(query));

  const insert = (slug: string): void => {
    setText((t) => t.replace(/@[\w-]*$/, `@${slug} `));
    setActive(0);
  };

  const send = (): void => {
    const { target, text: body } = parseTarget(workflow, text);
    if (!body) return;
    workflowStore.setRailCollapsed(true);
    setText("");
    void actions.message(run.id, target, body);
  };

  return (
    <section className="run-chat" aria-label="Run chat" data-testid="run-chat">
      <ul className="chat-log" role="log" aria-label="Chat messages" data-testid="chat-log">
        {(run.messages ?? []).map((m) => (
          <MessageLine key={m.id} message={m} workflow={workflow} />
        ))}
      </ul>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {options.length > 0 && (
          <ul className="chat-picker" role="listbox" aria-label="Steps" data-testid="chat-picker">
            {options.map((s, i) => (
              <li key={s.id} role="option" aria-selected={i === active}>
                <button type="button" className="chat-picker-option" onClick={() => insert(s.slug)}>
                  {`@${s.slug}`}
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          className="chat-input"
          data-testid="chat-input"
          aria-label="Message the run"
          placeholder="Ask the run, or @step to ask one step"
          value={text}
          onFocus={() => workflowStore.setRailCollapsed(true)}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (options.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % options.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + options.length) % options.length);
            } else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              insert(options[active % options.length].slug);
            }
          }}
        />
        <button type="submit" className="workflow-header-button" data-testid="chat-send">
          Send
        </button>
      </form>
    </section>
  );
}
