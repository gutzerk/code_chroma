import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import type { EngineClient } from "../engine-client/EngineClient";
import { IMPACT_CHANGES_STUB } from "../engine-client/stubEngineClient";
import type { AgentQuestionsPayload, CanvasElement } from "../state/types";
import { WIRE_OPTIONS } from "../canvas/doc/question/fixtures";
import type { AgentClient } from "./agentClient";
import { AgentClientProvider } from "./AgentClientContext";
import { AgentQuestionHost } from "./AgentQuestionHost";
import { agentQuestionStore } from "./agentQuestions";
import { agentStore } from "./agentStore";
import { agentQuestionsFromDoc } from "./mockAgentClient";
import { PR_CLIENT_STUB } from "./stubAgentClient";

function question(id: string, agentId: string, state = "open", extra: Record<string, unknown> = {}): CanvasElement {
  return {
    id, render: "question", layer: "questions", label: `${id}?`, description: "", node_id: null,
    position: { x: 0, y: 0 }, size: { w: 200, h: 100 }, group_id: null, created_by: "ai",
    meta: { question_id: id, session_id: "s1", step: 1, state, agent_id: agentId, options: WIRE_OPTIONS, ...extra },
  };
}

function payload(elements: CanvasElement[]): AgentQuestionsPayload {
  const open = elements.filter((el) => el.meta.state === "open").length;
  return { agent_id: "ag1", workspace: "main", open_questions: open, elements: Object.fromEntries(elements.map((el) => [el.id, el])), edges: {} };
}

afterEach(() => {
  agentQuestionStore.reset();
  agentStore.reset();
});

describe("agent-scoped questions", () => {
  it("shows and answers the agent's question through its own routes while another tab is active", async () => {
    agentStore.setActiveWorkspace("br_wt-1");
    const questions = vi.fn(async () => payload([question("q1", "ag1")]));
    const answerQuestion = vi.fn(async () => ({ question_id: "q1", state: "answered" as const }));
    const agentClient = { ...PR_CLIENT_STUB, questions, answerQuestion } as unknown as AgentClient;
    const engineAnswer = vi.fn();
    const engine = { ...IMPACT_CHANGES_STUB, answerQuestion: engineAnswer } as unknown as EngineClient;
    render(
      <EngineClientProvider repoId="br_wt-1" client={engine}>
        <AgentClientProvider client={agentClient}>
          <AgentQuestionHost agentId="ag1" onFocusTerminal={vi.fn()}>
            <div data-testid="term" />
          </AgentQuestionHost>
        </AgentClientProvider>
      </EngineClientProvider>,
    );
    await screen.findByTestId("question-card");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(answerQuestion).toHaveBeenCalledWith("ag1", "q1", { answer: "Modular monolith", option_id: "a" }));
    await waitFor(() => expect(questions).toHaveBeenCalledTimes(2));
    expect(engineAnswer).not.toHaveBeenCalled();
  });

  it("one watch per agent: a second window shares the first fetch, the last release stops it", async () => {
    const questions = vi.fn(async () => payload([question("q1", "ag1")]));
    const client = { ...PR_CLIENT_STUB, questions } as unknown as AgentClient;
    const first = agentQuestionStore.watch(client, "ag1");
    const second = agentQuestionStore.watch(client, "ag1");
    await waitFor(() => expect(Object.keys(agentQuestionStore.getDoc("ag1").elements)).toEqual(["q1"]));

    first();
    second();
    agentQuestionStore.refresh("ag1");

    expect(questions).toHaveBeenCalledTimes(1);
    expect(agentQuestionStore.getDoc("ag1").elements).toEqual({});
  });

  it("the mock bridge mirrors the route: open questions, their session's history, never another agent's", () => {
    const doc = {
      schema_version: 1, doc_id: "d", updated_at: "", edges: {},
      elements: {
        q1: question("q1", "ag1"),
        q0: question("q0", "ag1", "answered"),
        q2: question("q2", "other"),
        q3: question("q3", "ag1", "answered", { session_id: "elsewhere" }),
      },
    };

    const result = agentQuestionsFromDoc(doc, "ag1");

    expect(Object.keys(result.elements).sort()).toEqual(["q0", "q1"]);
    expect(result.open_questions).toBe(1);
  });
});
