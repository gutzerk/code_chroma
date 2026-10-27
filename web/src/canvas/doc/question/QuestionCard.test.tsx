import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QuestionCard, type QuestionCardProps } from "./QuestionCard";
import { OPTIONS, viewOf } from "./fixtures";

function props(overrides: Partial<QuestionCardProps> = {}): QuestionCardProps {
  return {
    question: viewOf(), history: [], onChooseOption: vi.fn(), onCustomAnswer: vi.fn(),
    onSkip: vi.fn(), onRevise: vi.fn(), ...overrides,
  };
}

describe("QuestionCard", () => {
  it("shows progress and the title for an open question", () => {
    render(<QuestionCard {...props()} />);

    expect(screen.getByText(/Question 2 of 4/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("How should checkout be structured?")).toBeInTheDocument();
  });

  it("preselects the rank-1 option and Send confirms it", () => {
    const p = props();
    render(<QuestionCard {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByTestId("question-option-a")).toHaveAttribute("aria-checked", "true");
    expect(p.onChooseOption).toHaveBeenCalledWith("a");
  });

  it("a click only selects, and Send then answers with that option", () => {
    const p = props();
    render(<QuestionCard {...p} />);

    fireEvent.click(screen.getByTestId("question-option-c"));
    const answeredByClick = (p.onChooseOption as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(answeredByClick).toBe(0);
    expect(p.onChooseOption).toHaveBeenCalledWith("c");
  });

  it("number keys and arrows move the selection and Enter sends", () => {
    const p = props();
    render(<QuestionCard {...p} />);
    const card = screen.getByTestId("question-card");

    fireEvent.keyDown(card, { key: "2" });
    fireEvent.keyDown(card, { key: "ArrowDown" });
    fireEvent.keyDown(card, { key: "Enter" });

    expect(p.onChooseOption).toHaveBeenCalledWith("c");
  });

  it("Escape skips only when allowed", () => {
    const p = props();
    const { rerender } = render(<QuestionCard {...p} />);

    fireEvent.keyDown(screen.getByTestId("question-card"), { key: "Escape" });
    rerender(<QuestionCard {...props({ question: viewOf({ allowSkip: false }), onSkip: p.onSkip })} />);
    fireEvent.keyDown(screen.getByTestId("question-card"), { key: "Escape" });

    expect(p.onSkip).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the terminal on Shift+Tab, Ctrl+Enter and after an answer", () => {
    const onReturnFocus = vi.fn();
    render(<QuestionCard {...props({ onReturnFocus })} />);
    const card = screen.getByTestId("question-card");

    fireEvent.keyDown(card, { key: "Tab", shiftKey: true });
    fireEvent.keyDown(card, { key: "Enter", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onReturnFocus).toHaveBeenCalledTimes(3);
  });

  it("reports the picked option to the host", () => {
    const onSelectedIdChange = vi.fn();
    render(<QuestionCard {...props({ onSelectedIdChange })} />);

    fireEvent.click(screen.getByTestId("question-option-b"));

    expect(onSelectedIdChange).toHaveBeenLastCalledWith("b");
  });

  it("sends the host-controlled selection, not its own", () => {
    const p = props({ selectedId: "b" });
    render(<QuestionCard {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(p.onChooseOption).toHaveBeenCalledWith("b");
  });

  it("falls back to the recommended option when the picked one disappeared after a re-ask", () => {
    const p = props();
    const { rerender } = render(<QuestionCard {...p} />);
    fireEvent.click(screen.getByTestId("question-option-c"));
    const reasked = viewOf({ options: OPTIONS.filter((o) => o.id !== "c") });

    rerender(<QuestionCard {...props({ question: reasked, onChooseOption: p.onChooseOption })} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(p.onChooseOption).toHaveBeenCalledWith("a");
  });

  it("ignores Escape while a request is in flight", () => {
    const p = props({ busy: true });
    render(<QuestionCard {...p} />);

    fireEvent.keyDown(screen.getByTestId("question-card"), { key: "Escape" });

    expect(p.onSkip).not.toHaveBeenCalled();
  });

  it("submits a trimmed custom answer and clears the input", () => {
    const p = props();
    render(<QuestionCard {...p} />);
    const input = screen.getByLabelText("Your own answer");

    fireEvent.change(input, { target: { value: "  Hybrid  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(p.onCustomAnswer).toHaveBeenCalledWith("Hybrid");
    expect(p.onChooseOption).not.toHaveBeenCalled();
    expect(input).toHaveValue("");
  });

  it("disables Send when nothing is selected and no text is typed", () => {
    render(<QuestionCard {...props({ question: viewOf({ options: [] }) })} />);

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("skips, and hides skip/custom when not allowed", () => {
    const p = props();
    const { rerender } = render(<QuestionCard {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    rerender(<QuestionCard {...props({ question: viewOf({ allowSkip: false, allowCustom: false }) })} />);

    expect(p.onSkip).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(screen.queryByLabelText("Your own answer")).toBeNull();
  });

  it("collapses an answered question to one line with a change button", () => {
    const answered = viewOf({ state: "answered", answer: "Events" });
    const p = props({ question: answered });
    render(<QuestionCard {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    expect(screen.getByText("✓ Q2 · How should checkout be structured? · Events")).toBeInTheDocument();
    expect(screen.queryByTestId("question-options")).toBeNull();
    expect(p.onRevise).toHaveBeenCalledWith(answered);
  });

  it("shows the last earlier answer and opens the history from it, plus an error alert", () => {
    const done = viewOf({ elementId: "q0", step: 1, state: "answered", answer: "Beginners" });
    render(<QuestionCard {...props({ history: [done], error: "boom" })} />);

    fireEvent.click(screen.getByRole("button", { name: /Earlier: Beginners/ }));

    expect(screen.getByTestId("question-history")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
  it("offers Add diagram when an option has none and disables it once requested", () => {
    const p = props({ onRequestDiagram: vi.fn() });
    const { rerender } = render(<QuestionCard {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Add diagram" }));
    rerender(<QuestionCard {...p} question={viewOf({ diagramRequested: true, diagramRequests: 1 })} />);

    expect(p.onRequestDiagram).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Diagram requested" })).toBeDisabled();
  });

  it("hides Add diagram when every option has a diagram or it was requested twice", () => {
    const withAll = OPTIONS.map((o) => ({ ...o, diagramRef: "el-1" }));
    const p = props({ onRequestDiagram: vi.fn(), question: viewOf({ options: withAll }) });
    const { rerender } = render(<QuestionCard {...p} />);
    const hiddenWhenAll = screen.queryByRole("button", { name: "Add diagram" });

    rerender(<QuestionCard {...p} question={viewOf({ diagramRequests: 2 })} />);

    expect(hiddenWhenAll).toBeNull();
    expect(screen.queryByRole("button", { name: "Add diagram" })).toBeNull();
  });

  it("offers Chat about it only when a chat handler is given", () => {
    const p = props({ onChat: vi.fn() });
    const { rerender } = render(<QuestionCard {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Chat about it" }));
    rerender(<QuestionCard {...p} onChat={undefined} />);

    expect(p.onChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Chat about it" })).toBeNull();
  });
});
