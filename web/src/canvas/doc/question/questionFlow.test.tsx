import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { canvasDocStore, useCanvasDoc } from "../canvasDocStore";
import { useLoadCanvasDoc } from "../canvasDocSync";
import { EngineClientProvider, useEngineClient } from "../../../engine-client/EngineClientContext";
import { MockBridgeEngineClient } from "../../../engine-client/mockBridge";
import type { CanvasOp } from "../../../state/types";
import { ConnectedQuestionCard } from "./ConnectedQuestionCard";
import { WIRE_OPTIONS } from "./fixtures";
import { toQuestionView } from "./questionAdapter";
import { listOpenQuestions } from "./questionClient";
import { QUESTION_STRINGS } from "./questionStrings";

function addQuestion(step: number, title: string): CanvasOp {
  return {
    op: "add_element", render: "question", layer: "questions", label: title,
    position: { x: 400, y: 100 + step * 600 },
    meta: { session_id: "s1", step, total: 2, state: "open", options: WIRE_OPTIONS },
  } as CanvasOp;
}

afterEach(() => canvasDocStore.reset());

/** Renders one connected card per question element in the live doc, as the agent window would. */
function Cards({ onReturnFocus }: { onReturnFocus?: () => void }) {
  const client = useEngineClient();
  useLoadCanvasDoc(client);
  const doc = useCanvasDoc();
  return <>{Object.values(doc.elements).filter((el) => el.render === "question").map((el) => <ConnectedQuestionCard key={el.id} question={toQuestionView(el)} client={client} doc={doc} onReturnFocus={onReturnFocus} />)}</>;
}

async function mount(ops: CanvasOp[], { client = new MockBridgeEngineClient(), onReturnFocus }: { client?: MockBridgeEngineClient; onReturnFocus?: () => void } = {}) {
  await client.patchCanvas({ ops, layer: "default", explanation: "", confirm_mass_delete: false });
  render(
    <EngineClientProvider repoId="default" client={client}>
      <Cards onReturnFocus={onReturnFocus} />
    </EngineClientProvider>,
  );
  await screen.findByText("First?");
  return client;
}

describe("question answer flow (mock bridge)", () => {
  it("answers by selecting an option and pressing Send, collapsing the card and closing the open list", async () => {
    const client = await mount([addQuestion(1, "First?")]);

    expect(await listOpenQuestions(client)).toHaveLength(1);
    fireEvent.click(screen.getByTestId("question-option-b"));
    expect(await listOpenQuestions(client)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText(/✓ .*Services/)).toBeInTheDocument());
    expect(await listOpenQuestions(client)).toHaveLength(0);
  });

  it("answers with custom text and records it", async () => {
    await mount([addQuestion(1, "First?")]);

    fireEvent.change(screen.getByLabelText("Your own answer"), { target: { value: "Something else" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText(/Something else/)).toBeInTheDocument());
  });

  it("skips a question", async () => {
    await mount([addQuestion(1, "First?")]);

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => expect(screen.getByText(/Skipped/)).toBeInTheDocument());
  });

  it("Chat about it closes the question as a chat request", async () => {
    const client = await mount([addQuestion(1, "First?")]);

    fireEvent.click(screen.getByRole("button", { name: "Chat about it" }));

    await waitFor(() => expect(screen.getByText(/Discussing in chat/)).toBeInTheDocument());
    expect(await listOpenQuestions(client)).toHaveLength(0);
  });

  it("Chat about it hands focus to the agent terminal once the question is closed", async () => {
    const onReturnFocus = vi.fn();
    await mount([addQuestion(1, "First?")], { onReturnFocus });

    fireEvent.click(screen.getByRole("button", { name: "Chat about it" }));

    await waitFor(() => expect(onReturnFocus).toHaveBeenCalledTimes(1));
  });

  it("keeps focus on the card when Chat about it fails", async () => {
    const client = new MockBridgeEngineClient();
    client.chatQuestion = () => Promise.reject(new Error("bridge down"));
    const onReturnFocus = vi.fn();
    await mount([addQuestion(1, "First?")], { client, onReturnFocus });

    fireEvent.click(screen.getByRole("button", { name: "Chat about it" }));

    await screen.findByText(QUESTION_STRINGS.failed);
    expect(onReturnFocus).not.toHaveBeenCalled();
  });

  it("revise reopens the question and drops later steps", async () => {
    const client = await mount([addQuestion(1, "First?"), addQuestion(2, "Second?")]);
    const first = Object.values((await client.getCanvas()).elements).find((el) => el.label === "First?")!;
    await client.answerQuestion(first.id, { answer: "Services", option_id: "b" });
    await waitFor(() => expect(screen.getByText(/✓ .*Services/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    await waitFor(() => expect(screen.queryByText("Second?")).toBeNull());
    expect(screen.getByText("First?")).toBeInTheDocument();
    expect(screen.getByTestId("question-option-a")).toBeInTheDocument();
  });

  it("shows earlier decisions in the open question's history", async () => {
    const client = await mount([addQuestion(1, "First?"), addQuestion(2, "Second?")]);
    const first = Object.values((await client.getCanvas()).elements).find((el) => el.label === "First?")!;

    await client.answerQuestion(first.id, { answer: "Services", option_id: "b" });

    fireEvent.click(await screen.findByRole("button", { name: /Earlier: Services/ }));

    expect(screen.getByTestId("question-history")).toHaveTextContent("Services");
  });
});
