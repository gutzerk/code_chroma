import { describe, expect, it } from "vitest";
import {
  activeIndexAt,
  clampIndex,
  filterPrompts,
  findPromptLines,
  formatTime,
  promptBlockHeight,
  replySummary,
  toPrompts,
} from "./promptNav";

const raw = (text: string, edits = 0, runs = 0) => ({ id: text, text, createdAt: null, edits, runs });

describe("prompt list", () => {
  it("numbers prompts from 1 and summarises each reply", () => {
    const prompts = toPrompts([raw("fix it", 1, 1), raw("why?"), raw("again", 2, 3)]);

    expect(prompts.map((p) => [p.index, p.summary])).toEqual([
      [1, "1 edit, 1 run"],
      [2, "answer"],
      [3, "2 edits, 3 runs"],
    ]);
  });

  it.each([
    [0, 1, "1 run"],
    [3, 0, "3 edits"],
  ])("summarises %i edits and %i runs as %s", (edits, runs, expected) => {
    expect(replySummary(edits, runs)).toBe(expected);
  });

  it("filters by text without case", () => {
    const prompts = toPrompts([raw("Fix the Token refresh"), raw("Add a test"), raw("token callers")]);

    const found = filterPrompts(prompts, "  TOKEN ");

    expect(found.map((p) => p.index)).toEqual([1, 3]);
  });
});

describe("index bounds", () => {
  it.each([
    [0, 5, 1],
    [6, 5, 5],
    [3, 5, 3],
    [2, 0, 0],
  ])("clamps %i into 1..%i as %i", (index, total, expected) => {
    expect(clampIndex(index, total)).toBe(expected);
  });
});

describe("active prompt", () => {
  it("is the last prompt starting at or above the viewport top plus slack", () => {
    const lines = [0, 40, null, 120];

    expect([activeIndexAt(lines, 0), activeIndexAt(lines, 38), activeIndexAt(lines, 100), activeIndexAt(lines, 500)]).toEqual([1, 2, 2, 4]);
  });

  it("falls back to the first prompt above every echo", () => {
    expect(activeIndexAt([null, 50], 0)).toBe(1);
  });
});

describe("finding prompt echoes in the terminal buffer", () => {
  const buffer = [
    "╭ Claude Code ╮",
    "> Fix the token refresh race in",
    "  auth/session.py",
    "",
    "● Reading src/auth/session.py",
    "> why?",
    "",
    "● Because.",
    "> why?",
  ];

  it("maps each prompt to its own echo in order, wrapped first lines included", () => {
    const lines = findPromptLines(buffer, [
      { text: "Fix the token refresh race in auth/session.py" },
      { text: "why?" },
      { text: "why?" },
    ]);

    expect(lines).toEqual([1, 5, 8]);
  });

  it("returns null for a prompt that has left the buffer", () => {
    expect(findPromptLines(buffer, [{ text: "an old prompt nobody can see" }, { text: "why?" }])).toEqual([null, 8]);
  });

  it("maps a repeated prompt to its own echo after the first one left the scrollback", () => {
    const trimmed = ["● Done.", "> continue", "", "● Next step.", "> Add a test", "", "● Added.", "> continue"];

    const lines = findPromptLines(trimmed, [{ text: "continue" }, { text: "plan" }, { text: "continue" }, { text: "Add a test" }, { text: "continue" }]);

    expect(lines).toEqual([null, null, 1, 4, 7]);
  });

  it.each([
    ["a short prompt against a longer echo", ["> yes please"], "y"],
    ["a reply line that starts like the prompt", ["● Review the code first", "  Review the code"], "Review the code in src/app.ts"],
    ["the input box holding a draft", ["│ > continue                │", "╰───────────╯"], "continue"],
  ])("does not match %s", (_name, rows, text) => {
    expect(findPromptLines(rows, [{ text }])).toEqual([null]);
  });

  it.each([
    ["a bash-mode command", ["! git status"], "!git status"],
    ["a multi-line prompt with a blank line", ["> Fix it", "", "  then add a test", "", "● Ok."], "Fix it\n\nthen add a test"],
    ["an echo with hook output under it", ["❯ а что мы еще раз тут делаем?h", "  ⎿  1 skill available", "", "● Мы меняем способ"], "а что мы еще раз тут делаем?h"],
  ])("matches %s", (_name, rows, text) => {
    expect(findPromptLines(rows, [{ text }])).toEqual([0]);
  });

  it("measures a prompt's echo up to the next blank line", () => {
    expect(promptBlockHeight(buffer, 1)).toBe(2);
  });
});

describe("time", () => {
  it("formats a timestamp as local HH:MM and a missing one as empty", () => {
    const iso = new Date(2026, 10, 3, 9, 5).toISOString();

    expect([formatTime(iso), formatTime(null), formatTime("nope")]).toEqual(["09:05", "", ""]);
  });
});
