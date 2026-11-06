import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { QuestionActions } from "../canvas/doc/question/questionClient";
import { Store } from "../state/createStore";
import { EMPTY_CANVAS_DOC, type CanvasDoc } from "../state/types";
import { reportAsyncError } from "../util/reportError";
import type { AgentClient } from "./agentClient";
import { useOptionalAgentClient } from "./AgentClientContext";
import { agentStore } from "./agentStore";

/** One agent the windows show: its client, its latest question doc and how many windows hold it. */
interface Watch {
  client: AgentClient;
  doc: CanvasDoc;
  refs: number;
  inFlight: boolean;
  dirty: boolean;
}

/** Each shown agent's questions from GET /agents/{id}/questions, refetched on its `agent-questions` event; one fetch per agent, no canvas docs or sockets. */
class AgentQuestionStore extends Store {
  private readonly watches = new Map<string, Watch>();

  /** The agent's question doc (questions, history, option diagrams); empty while not loaded. */
  getDoc = (agentId: string): CanvasDoc => this.watches.get(agentId)?.doc ?? EMPTY_CANVAS_DOC;

  /** Keeps `agentId`'s questions loaded while a window shows it; returns the release. */
  watch(client: AgentClient, agentId: string): () => void {
    let watch = this.watches.get(agentId);
    if (!watch || watch.client !== client) {
      watch = { client, doc: EMPTY_CANVAS_DOC, refs: 0, inFlight: false, dirty: false };
      this.watches.set(agentId, watch);
      this.refresh(agentId);
    }
    const held = watch;
    held.refs += 1;
    return () => {
      held.refs -= 1;
      if (held.refs > 0 || this.watches.get(agentId) !== held) return;
      this.watches.delete(agentId);
      this.emit();
    };
  }

  /** Refetches a shown agent (no-op otherwise); a refresh during a fetch becomes one more fetch after it. */
  refresh = (agentId: string): void => {
    const watch = this.watches.get(agentId);
    if (!watch?.client.questions) return;
    if (watch.inFlight) {
      watch.dirty = true;
      return;
    }
    watch.inFlight = true;
    watch.dirty = false;
    watch.client
      .questions(agentId)
      .then((payload) => {
        if (this.watches.get(agentId) !== watch) return;
        watch.doc = { ...EMPTY_CANVAS_DOC, doc_id: `agent-questions:${agentId}`, elements: payload.elements, edges: payload.edges };
        agentStore.setOpenQuestions(agentId, payload.open_questions);
        this.emit();
      })
      .catch((cause: unknown) => reportAsyncError(`agent questions (${agentId})`, cause))
      .finally(() => {
        watch.inFlight = false;
        if (watch.dirty && this.watches.get(agentId) === watch) this.refresh(agentId);
      });
  };

  /** Global (agents span every workspace), so only tests call it. */
  reset(): void {
    this.watches.clear();
    this.emit();
  }
}

export const agentQuestionStore = new AgentQuestionStore().markGlobalStore();

/** The question writes bound to one agent's routes; each one refetches that agent once it lands. */
export function agentQuestionActions(client: AgentClient, agentId: string): QuestionActions {
  const run = <T>(call: Promise<T> | undefined): Promise<T> =>
    call
      ? call.finally(() => agentQuestionStore.refresh(agentId))
      : Promise.reject(new Error("this bridge has no agent question routes"));
  return {
    answerQuestion: (questionId, body) => run(client.answerQuestion?.(agentId, questionId, body)),
    skipQuestion: (questionId) => run(client.skipQuestion?.(agentId, questionId)),
    reviseQuestion: (questionId) => run(client.reviseQuestion?.(agentId, questionId)),
    requestQuestionDiagram: (questionId) => run(client.requestQuestionDiagram?.(agentId, questionId)),
  };
}

/** One agent's questions as its window shows them, plus writes bound to that agent; null without an agent client. */
export function useAgentQuestions(agentId: string): { doc: CanvasDoc; actions: QuestionActions } | null {
  const client = useOptionalAgentClient();
  useEffect(() => (client ? agentQuestionStore.watch(client, agentId) : undefined), [client, agentId]);
  const doc = useSyncExternalStore(agentQuestionStore.subscribe, () => agentQuestionStore.getDoc(agentId));
  const actions = useMemo(() => (client ? agentQuestionActions(client, agentId) : null), [client, agentId]);
  return actions ? { doc, actions } : null;
}
