import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptPicker } from "./PromptPicker";
import { toPrompts } from "./promptNav";

const prompts = toPrompts(["one", "two", "three"].map((text) => ({ id: text, text, createdAt: null, edits: 0, runs: 0 })));

describe("PromptPicker", () => {
  it("moves its cursor to the current prompt when the terminal scrolls, and marks the cursor as selected", () => {
    const onPick = vi.fn();
    const props = { prompts, lines: [1, 2, 3], onPick, variant: "outline" as const };
    const { rerender } = render(<PromptPicker {...props} current={1} />);

    rerender(<PromptPicker {...props} current={3} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(onPick).toHaveBeenCalledWith(3);
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent("three");
  });
});
