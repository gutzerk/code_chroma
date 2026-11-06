import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentQuestionHost } from "./AgentQuestionHost";
import { AgentLed } from "./AgentLed";
import { questionWorkspaceOf, useAgentQuestionSync } from "./agentQuestionSource";
import { agentStore } from "./agentStore";
import { canvasDocStore } from "../canvas/doc/canvasDocStore";
import { workspaceQuestionDocs } from "../canvas/doc/question/workspaceQuestionDocs";
import { WIRE_OPTIONS } from "../canvas/doc/question/fixtures";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import type { EngineClient } from "../engine-client/EngineClient";
import { MockBridgeEngineClient } from "../engine-client/mockBridge";
import type { AgentRecord, CanvasOp } from "../state/types";

function agent(id: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id, title: id, kind: "claude", branch: id, worktree: `/w/${id}`, workspace: "br_wt-1", created_at: "",
    session_id: null, pr_url: null, pid: null, window: { x: 0, y: 0, width: 300, height: 300, minimized: false, z: 1 },
    status: "idle", exit_code: null, worktree_lost: false, ...overrides,
  };
}

function ask(agentId: string, title: string): CanvasOp {
  return {
    op: "add_element", render: "question", layer: "questions", label: title, position: { x: 400, y: 100 },
    meta: { question_id: "q1", session_id: "s", step: 1, total: 1, state: "open", agent_id: agentId, options: WIRE_OPTIONS },
  } as CanvasOp;
}

function Sync({ makeClient }: { makeClient: (repoId: string) => EngineClient }) {
  useAgentQuestionSync(makeClient);
  return null;
}

/** agent3 shares `main` while the canvas draws `br_wt-1`; its question sits only in main's doc. */
async function mountSharedAgent() {
  agentStore.setList({ agents: [agent("agent3", { shares_workspace_with: "main" })], max_agents: 8 });
  agentStore.setActiveWorkspace("br_wt-1");
  const active = new MockBridgeEngineClient();
  const main = new MockBridgeEngineClient();
  await main.patchCanvas({ ops: [ask("agent3", "Which store?")], layer: "default", explanation: "", confirm_mass_delete: false });
  const makeClient = vi.fn((repoId: string) => (repoId === "main" ? main : new MockBridgeEngineClient()));
  render(
    <EngineClientProvider repoId="br_wt-1" client={active}>
      <Sync makeClient={makeClient} />
      <AgentLed status="idle" agentId="agent3" />
      <AgentQuestionHost agentId="agent3" onFocusTerminal={() => {}}>
        <div data-testid="term" />
      </AgentQuestionHost>
    </EngineClientProvider>,
  );
  return { active, main, makeClient };
}

afterEach(() => {
  workspaceQuestionDocs.reset();
  canvasDocStore.reset();
  agentStore.reset();
});

describe("questionWorkspaceOf", () => {
  it.each([
    ["an own-worktree agent asks into its own id", "a1", "a1"],
    ["a shared agent asks into the id it shares", "a2", "main"],
    ["a chain of shares resolves to the last workspace", "a3", "main"],
    ["an unknown agent has no workspace", "ghost", null],
  ])("%s", (_name, id, expected) => {
    const agents = [agent("a1"), agent("a2", { shares_workspace_with: "main" }), agent("a3", { shares_workspace_with: "a2" })];

    expect(questionWorkspaceOf(id, agents)).toBe(expected);
  });
});

describe("agent questions outside the active workspace", () => {
  it("shows the card and the LED count from the agent's own workspace", async () => {
    const { makeClient } = await mountSharedAgent();

    const card = await screen.findByTestId("question-card");

    expect(card).toHaveTextContent("Which store?");
    expect(makeClient).toHaveBeenCalledWith("main");
    expect(screen.getByLabelText(/1 question/)).toBeInTheDocument();
  });

  it("posts the answer to the agent's workspace, not the active one", async () => {
    const { active, main } = await mountSharedAgent();
    const toMain = vi.spyOn(main, "answerQuestion");
    const toActive = vi.spyOn(active, "answerQuestion");
    await screen.findByTestId("question-card");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(toMain).toHaveBeenCalledWith("q1", expect.objectContaining({ option_id: expect.any(String) })));
    expect(toActive).not.toHaveBeenCalled();
  });
});
