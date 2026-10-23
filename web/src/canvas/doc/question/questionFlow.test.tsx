import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CanvasDocView } from "../CanvasDocView";
import { canvasDocStore } from "../canvasDocStore";
import { EngineClientProvider } from "../../../engine-client/EngineClientContext";
import { MockBridgeEngineClient } from "../../../engine-client/mockBridge";
import type { CanvasOp } from "../../../state/types";
import { WIRE_OPTIONS } from "./fixtures";
import { listOpenQuestions } from "./questionClient";

function addQuestion(step: number, title: string): CanvasOp {
  return {
    op: "add_element", render: "question", layer: "questions", label: title,
    position: { x: 400, y: 100 + step * 600 },
    meta: { session_id: "s1", step, total: 2, state: "open", options: WIRE_OPTIONS },
  } as CanvasOp;
}

afterEach(() => canvasDocStore.reset());

async function mount(ops: CanvasOp[]) {
  const client = new MockBridgeEngineClient();
  await client.patchCanvas({ ops, layer: "default", explanation: "", confirm_mass_delete: false });
  render(
    <EngineClientProvider repoId="default" client={client}>
      <CanvasDocView />
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
