import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DecisionHistory } from "./DecisionHistory";
import { viewOf } from "./fixtures";

describe("DecisionHistory", () => {
  it("shows an empty hint with no items", () => {
    render(<DecisionHistory items={[]} onRevise={() => {}} />);

    expect(screen.getByText("Your answers will appear here.")).toBeInTheDocument();
  });

  it("lists answers and skips and revises the clicked one", () => {
    const answered = viewOf({ elementId: "q1", step: 1, state: "answered", answer: "Beginners", title: "Who for?" });
    const skipped = viewOf({ elementId: "q2", step: 2, state: "skipped", title: "Pending?" });
    const onRevise = vi.fn();
    render(<DecisionHistory items={[answered, skipped]} onRevise={onRevise} />);

    fireEvent.click(screen.getByRole("button", { name: "Revise 1" }));

    expect(screen.getAllByTestId("question-history-item")[0]).toHaveTextContent("Beginners");
    expect(screen.getAllByTestId("question-history-item")[1]).toHaveTextContent("Skipped");
    expect(onRevise).toHaveBeenCalledWith(answered);
  });
});
