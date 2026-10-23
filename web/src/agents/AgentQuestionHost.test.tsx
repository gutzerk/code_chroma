import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentQuestionHost } from "./AgentQuestionHost";
import { canvasDocStore, useLoadCanvasDoc } from "../canvas/doc/canvasDocStore";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { MockBridgeEngineClient } from "../engine-client/mockBridge";
import type { CanvasOp } from "../state/types";
import { WIRE_OPTIONS } from "../canvas/doc/question/fixtures";

function ask(agent: string, title: string, step: number, extra: Record<string, unknown> = {}): CanvasOp {
  return {
    op: "add_element", render: "question", layer: "questions", label: title,
    position: { x: 400, y: 100 + step * 600 },
    meta: { session_id: "s", step, total: 3, state: "open", agent_id: agent, options: WIRE_OPTIONS, ...extra },
  } as CanvasOp;
}

function Loader() {
  useLoadCanvasDoc(useEngineClient());
  return null;
}

async function mount(ops: CanvasOp[], agent = "ag1", onFocusTerminal = vi.fn()) {
  const client = new MockBridgeEngineClient();
  await client.patchCanvas({ ops, layer: "default", explanation: "", confirm_mass_delete: false });
  render(
    <EngineClientProvider repoId="default" client={client}>
      <Loader />
      <AgentQuestionHost agentId={agent} onFocusTerminal={onFocusTerminal}>
        <div className="agent-window-terminal" data-testid="term"><input aria-label="term-input" /></div>
      </AgentQuestionHost>
    </EngineClientProvider>,
  );
  return { client, onFocusTerminal };
}

afterEach(() => canvasDocStore.reset());

describe("AgentQuestionHost", () => {
  it("renders only the terminal when the agent has no open question", async () => {
    await mount([ask("other", "Not mine", 1)]);

    expect(screen.getByTestId("term")).toBeInTheDocument();
    expect(screen.queryByTestId("question-card")).toBeNull();
  });

  it("shows only the agent's oldest open question and keeps the terminal mounted", async () => {
    await mount([ask("ag1", "Second?", 2), ask("ag1", "First?", 1), ask("other", "Other?", 1)]);

    const card = await screen.findByTestId("question-card");

    expect(card).toHaveTextContent("First?");
    expect(screen.queryByText("Second?")).toBeNull();
    expect(screen.queryByText("Other?")).toBeNull();
    expect(screen.getByTestId("term")).toBeInTheDocument();
  });

  it("uses the compact A2 layout when the host is narrow", async () => {
    await mount([ask("ag1", "First?", 1)]);

    await screen.findByTestId("question-card");

    expect(screen.getByTestId("agent-question-host-ag1")).toHaveAttribute("data-layout", "A2");
    expect(screen.queryByTestId("question-diagram")).toBeNull();
  });

  it("answering from the terminal closes the tray and returns focus to the terminal", async () => {
    const { onFocusTerminal } = await mount([ask("ag1", "First?", 1)]);
    await screen.findByTestId("question-card");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.queryByTestId("question-card")).toBeNull());
    expect(onFocusTerminal).toHaveBeenCalled();
  });

  it("Ctrl+Enter in the terminal moves focus into the card", async () => {
    await mount([ask("ag1", "First?", 1)]);
    const card = await screen.findByTestId("question-card");

    fireEvent.keyDown(screen.getByLabelText("term-input"), { key: "Enter", ctrlKey: true });

    expect(card).toHaveFocus();
  });

  it("does not steal focus when a question opens", async () => {
    await mount([ask("ag1", "First?", 1)]);
    const card = await screen.findByTestId("question-card");

    expect(card).not.toHaveFocus();
  });
});
