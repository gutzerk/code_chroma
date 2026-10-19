import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QuestionCard, type QuestionCardProps } from "./QuestionCard";
import { viewOf } from "./fixtures";

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

  it("submits a trimmed custom answer and clears the input", () => {
    const p = props();
    render(<QuestionCard {...p} />);
    const input = screen.getByLabelText("Your own answer");

    fireEvent.change(input, { target: { value: "  Hybrid  " } });
    fireEvent.click(screen.getByRole("button", { name: "Answer & continue" }));

    expect(p.onCustomAnswer).toHaveBeenCalledWith("Hybrid");
    expect(input).toHaveValue("");
  });

  it("does not submit an empty custom answer", () => {
    const p = props();
    render(<QuestionCard {...p} />);

    fireEvent.submit(screen.getByLabelText("Your own answer").closest("form")!);

    expect(p.onCustomAnswer).not.toHaveBeenCalled();
  });

  it("skips, and hides skip/custom when not allowed", () => {
    const p = props();
    const { rerender } = render(<QuestionCard {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    rerender(<QuestionCard {...props({ question: viewOf({ allowSkip: false, allowCustom: false }) })} />);

    expect(p.onSkip).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
    expect(screen.queryByLabelText("Your own answer")).toBeNull();
  });

  it("forwards an option choice", () => {
    const p = props();
    render(<QuestionCard {...p} />);

    fireEvent.click(screen.getByTestId("question-option-c"));

    expect(p.onChooseOption).toHaveBeenCalledWith("c");
  });

  it("collapses an answered question to its decision with a change button", () => {
    const answered = viewOf({ state: "answered", answer: "Events" });
    const p = props({ question: answered });
    render(<QuestionCard {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Change answer" }));

    expect(screen.getByText("✓ Events")).toBeInTheDocument();
    expect(screen.queryByTestId("question-options")).toBeNull();
    expect(p.onRevise).toHaveBeenCalledWith(answered);
  });

  it("renders the decision history when present and an error alert", () => {
    const done = viewOf({ elementId: "q0", step: 1, state: "answered", answer: "Beginners" });
    render(<QuestionCard {...props({ history: [done], error: "boom" })} />);

    expect(screen.getByTestId("question-history")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});
