import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QuestionOptions } from "./QuestionOptions";
import { OPTIONS } from "./fixtures";

describe("QuestionOptions", () => {
  it("pills only the rank-1 option as Recommended, never colouring the tile by rank", () => {
    render(<QuestionOptions options={OPTIONS} selectedId="b" onSelect={() => {}} />);

    expect(screen.getAllByText("Recommended")).toHaveLength(1);
    expect(screen.getByTestId("question-option-a")).toContainElement(screen.getByText("Recommended"));
    expect(screen.getByTestId("question-option-b").className).toBe("question-option");
  });

  it("exposes a radiogroup with the selected tile checked", () => {
    render(<QuestionOptions options={OPTIONS} selectedId="b" onSelect={() => {}} />);

    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Services/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Events/ })).toHaveAttribute("aria-checked", "false");
  });

  it("compact shows description and chips only for the selected tile", () => {
    render(<QuestionOptions options={OPTIONS} selectedId="b" variant="compact" onSelect={() => {}} />);

    expect(screen.getByText("Independent")).toBeInTheDocument();
    expect(screen.getByText("✓ Scalable")).toBeInTheDocument();
    expect(screen.queryByText("One deployment")).toBeNull();
  });

  it("full shows description and chips on every tile", () => {
    render(<QuestionOptions options={OPTIONS} selectedId="b" variant="full" onSelect={() => {}} />);

    expect(screen.getByText("One deployment")).toBeInTheDocument();
    expect(screen.getByText("✕ Complexity")).toBeInTheDocument();
  });

  it("reports the clicked option id and honours disabled", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<QuestionOptions options={OPTIONS} selectedId={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId("question-option-b"));
    rerender(<QuestionOptions options={OPTIONS} selectedId={null} onSelect={onSelect} disabled />);
    fireEvent.click(screen.getByTestId("question-option-c"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("leaves unranked options without a tier or pill", () => {
    render(<QuestionOptions options={[{ ...OPTIONS[0], rank: null }]} selectedId={null} onSelect={() => {}} />);

    expect(screen.getByTestId("question-option-a")).not.toHaveAttribute("data-tier");
    expect(screen.queryByText("Recommended")).toBeNull();
  });
});
