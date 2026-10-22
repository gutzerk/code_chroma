import { describe, expect, it } from "vitest";
import { isPasteChord } from "./useXtermSession";

describe("isPasteChord", () => {
  it.each([
    [{ ctrlKey: true, metaKey: false, altKey: false, key: "v" }, true],
    [{ ctrlKey: false, metaKey: true, altKey: false, key: "V" }, true],
    [{ ctrlKey: true, metaKey: false, altKey: false, key: "c" }, false],
    [{ ctrlKey: false, metaKey: false, altKey: false, key: "v" }, false],
    [{ ctrlKey: true, metaKey: false, altKey: true, key: "v" }, false],
  ])("classifies %j", (event, expected) => {
    const result = isPasteChord(event);

    expect(result).toBe(expected);
  });
});
