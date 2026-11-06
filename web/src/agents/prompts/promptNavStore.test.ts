import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JUMP_LOCK_MS, promptNavStore, type PromptViewport } from "./promptNavStore";
import { promptHotkey } from "./usePromptHotkeys";

const raw = (text: string) => ({ id: text, text, createdAt: null, edits: 0, runs: 0 });

function viewport(): PromptViewport & { [K in keyof PromptViewport]: ReturnType<typeof vi.fn> } {
  return { scrollToLine: vi.fn(), scrollToBottom: vi.fn(), highlight: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
  promptNavStore.reset();
});
afterEach(() => vi.useRealTimers());

describe("promptNavStore", () => {
  it("forgets agents that no longer exist", () => {
    promptNavStore.setPrompts("a", [raw("one")]);
    promptNavStore.setPrompts("b", [raw("two")]);

    promptNavStore.retain(["a"]);

    expect([promptNavStore.get("a").prompts.length, promptNavStore.get("b").prompts.length]).toEqual([1, 0]);
  });

  it("a cleared conversation drops its prompts, layout and highlight and starts the next list on its latest prompt", () => {
    const view = viewport();
    promptNavStore.attach("a", view);
    promptNavStore.setPrompts("a", [raw("one"), raw("two")]);
    promptNavStore.setLayout("a", [10, 80], 200);
    promptNavStore.go("a", 1);

    promptNavStore.clear("a");
    const cleared = promptNavStore.get("a");
    promptNavStore.setPrompts("a", [raw("fresh"), raw("start")]);

    expect([cleared.prompts.length, cleared.lines.length, cleared.current]).toEqual([0, 0, 0]);
    expect(view.highlight).toHaveBeenLastCalledWith(null);
    expect(promptNavStore.get("a").current).toBe(2);
  });

  it("starts on the latest prompt and keeps the place when the list grows", () => {
    promptNavStore.setPrompts("a", [raw("one"), raw("two")]);
    promptNavStore.go("a", 1);

    promptNavStore.setPrompts("a", [raw("one"), raw("two"), raw("three")]);

    expect(promptNavStore.get("a").current).toBe(1);
  });

  it("jumps by scrolling the prompt's line to the top, highlighting it and announcing it", () => {
    const view = viewport();
    promptNavStore.attach("a", view);
    promptNavStore.setPrompts("a", [raw("one"), raw("two")]);
    promptNavStore.setLayout("a", [10, 80], 200);

    promptNavStore.go("a", 1);

    expect(view.scrollToLine).toHaveBeenCalledWith(10);
    expect(view.highlight).toHaveBeenLastCalledWith(10);
    expect(promptNavStore.get("a").announce).toBe("Prompt 1 of 2");
  });

  it("stops prev and next at the ends", () => {
    promptNavStore.setPrompts("a", [raw("one"), raw("two")]);
    promptNavStore.setLayout("a", [10, 80], 200);

    promptNavStore.step("a", 1);
    const atEnd = promptNavStore.get("a").current;
    promptNavStore.go("a", 1);
    promptNavStore.step("a", -1);

    expect([atEnd, promptNavStore.get("a").current]).toEqual([2, 1]);
  });

  it("ignores scroll events from its own jump, then follows the viewport", () => {
    promptNavStore.setPrompts("a", [raw("one"), raw("two"), raw("three")]);
    promptNavStore.setLayout("a", [0, 50, 100], 120);
    promptNavStore.go("a", 3);

    promptNavStore.onViewport("a", 60);
    const duringJump = promptNavStore.get("a").current;
    vi.advanceTimersByTime(JUMP_LOCK_MS + 1);
    promptNavStore.onViewport("a", 60);

    expect([duringJump, promptNavStore.get("a").current]).toEqual([3, 2]);
  });

  it("keeps each agent's place separately", () => {
    promptNavStore.setPrompts("a", [raw("one"), raw("two")]);
    promptNavStore.setPrompts("b", [raw("x"), raw("y"), raw("z")]);

    promptNavStore.go("a", 1);

    expect([promptNavStore.get("a").current, promptNavStore.get("b").current]).toEqual([1, 3]);
  });

  it("scrolls to the bottom for Latest", () => {
    const view = viewport();
    promptNavStore.attach("a", view);

    promptNavStore.latest("a");

    expect(view.scrollToBottom).toHaveBeenCalled();
  });
});

describe("promptHotkey", () => {
  const key = (init: Partial<KeyboardEvent>) => ({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, key: "", code: "", ...init });

  it.each([
    [key({ altKey: true, key: "ArrowUp" }), "prev"],
    [key({ altKey: true, key: "ArrowDown" }), "next"],
    [key({ metaKey: true, shiftKey: true, key: "p", code: "KeyP" }), "find"],
    [key({ ctrlKey: true, shiftKey: true, key: "P", code: "KeyP" }), "find"],
    [key({ ctrlKey: true, altKey: true, key: "ArrowUp" }), null],
    [key({ key: "ArrowUp" }), null],
  ])("maps %o to %s", (event, expected) => {
    expect(promptHotkey(event)).toBe(expected);
  });
});
