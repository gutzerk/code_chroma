import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { PromptMarkers } from "./PromptMarkers";
import { promptNavStore } from "./promptNavStore";

const raw = (text: string) => ({ id: text, text, createdAt: null, edits: 0, runs: 0 });

beforeEach(() => {
  promptNavStore.reset();
  promptNavStore.setPrompts("a", [raw("one"), raw("two")]);
  promptNavStore.setLayout("a", [10, 80], 200);
});
afterEach(cleanup);

describe("PromptMarkers", () => {
  it("marks each prompt on the main buffer", () => {
    render(<PromptMarkers agentId="a" />);

    expect(screen.getAllByRole("button", { name: /Jump to prompt/ })).toHaveLength(2);
  });

  it("hides on the alternate buffer, which has no scrollback positions", () => {
    render(<PromptMarkers agentId="a" />);

    act(() => promptNavStore.setAlternate("a", true));

    expect(screen.queryByTestId("prompt-markers-a")).toBeNull();
  });
});
