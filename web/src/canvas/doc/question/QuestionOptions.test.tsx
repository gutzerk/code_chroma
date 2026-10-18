import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QuestionOptions } from "./QuestionOptions";
import { OPTIONS } from "./fixtures";

describe("QuestionOptions", () => {
  it("colours options by AI rank and badges only the recommended one", () => {
    render(<QuestionOptions options={OPTIONS} onChoose={() => {}} />);

    expect(screen.getByTestId("question-option-a")).toHaveAttribute("data-tier", "best");
    expect(screen.getByTestId("question-option-b")).toHaveAttribute("data-tier", "middle");
    expect(screen.getByTestId("question-option-c")).toHaveAttribute("data-tier", "last");
    expect(screen.getAllByText("Recommended")).toHaveLength(1);
  });

  it("shows pro and con text and the linked diagram ref", () => {
    render(<QuestionOptions options={OPTIONS} onChoose={() => {}} />);

    expect(screen.getByText("Simple")).toBeInTheDocument();
    expect(screen.getByText("Coordination")).toBeInTheDocument();
    expect(screen.getByText("Diagram: el-9")).toBeInTheDocument();
  });

  it("reports the chosen option id and honours disabled", () => {
    const onChoose = vi.fn();
    const { rerender } = render(<QuestionOptions options={OPTIONS} onChoose={onChoose} />);

    fireEvent.click(screen.getByTestId("question-option-b"));
    rerender(<QuestionOptions options={OPTIONS} onChoose={onChoose} disabled />);
    fireEvent.click(screen.getByTestId("question-option-c"));

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith("b");
  });

  it("leaves unranked options without a tier", () => {
    render(<QuestionOptions options={[{ ...OPTIONS[0], rank: null }]} onChoose={() => {}} />);

    expect(screen.getByTestId("question-option-a")).not.toHaveAttribute("data-tier");
  });
});
