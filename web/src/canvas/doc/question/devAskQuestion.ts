import type { CanvasOp } from "../../../state/types";
import type { EngineClient } from "../../../engine-client/EngineClient";

const TERMINAL_ID_PREFIX = "agent-terminal-";

const DEMO_OPTIONS = [
  { id: "a", title: "Modular monolith", description: "One deployment", pro: "Simple", con: "Shared release", rank: 1, why: "Fits an MVP", diagram_ref: null },
  { id: "b", title: "Services", description: "Independent", pro: "Scalable", con: "Coordination", rank: 2, why: "Adds work", diagram_ref: null },
];

/** Opt-in (VITE_DEV_ASK_QUESTION=1) mock-bridge preview only: Enter inside an agent terminal (or `askAgentQuestion()` in the console) asks a demo question as that agent. */
export function installDevAskQuestion(client: EngineClient): () => void {
  const ask = (agentId?: string) => {
    const id =
      agentId ??
      document.querySelector(`[data-testid^="${TERMINAL_ID_PREFIX}"]`)?.getAttribute("data-testid")?.slice(TERMINAL_ID_PREFIX.length);
    const op = {
      op: "add_element", render: "question", layer: "questions",
      label: "How should checkout be structured?",
      position: { x: 400, y: 200 },
      meta: { session_id: "demo", step: 1, total: 2, state: "open", agent_id: id ?? "", options: DEMO_OPTIONS },
    } as CanvasOp;
    return client.patchCanvas({ ops: [op], layer: "questions", explanation: "", confirm_mass_delete: false });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.target instanceof Element)) return;
    const terminal = event.target.closest(`[data-testid^="${TERMINAL_ID_PREFIX}"]`);
    const agentId = terminal?.getAttribute("data-testid")?.slice(TERMINAL_ID_PREFIX.length);
    if (!agentId || document.querySelector(`[data-testid="agent-question-${agentId}"]`)) return;
    void ask(agentId);
  };
  document.addEventListener("keydown", onKeyDown, true);
  (window as unknown as { askAgentQuestion?: typeof ask }).askAgentQuestion = ask;
  return () => {
    document.removeEventListener("keydown", onKeyDown, true);
    delete (window as unknown as { askAgentQuestion?: typeof ask }).askAgentQuestion;
  };
}
