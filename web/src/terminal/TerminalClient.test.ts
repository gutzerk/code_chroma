import { describe, expect, it } from "vitest";
import { decodeFrame } from "./TerminalClient";

describe("decodeFrame", () => {
  it("extracts the message from a tagged error frame", () => {
    expect(decodeFrame('e{"type":"error","message":"unknown agent: claude"}')).toEqual({
      kind: "error",
      message: "unknown agent: claude",
    });
  });

  it("strips the tag from ordinary shell output", () => {
    expect(decodeFrame("o$ ls -la\r\n")).toEqual({ kind: "output", data: "$ ls -la\r\n" });
  });

  it("renders shell output that happens to look like an error envelope", () => {
    expect(decodeFrame('o{"type":"error","message":"from a log file"}')).toEqual({
      kind: "output",
      data: '{"type":"error","message":"from a log file"}',
    });
  });

  it("renders an untagged frame whole rather than eating its first character", () => {
    expect(decodeFrame("legacy bridge output")).toEqual({
      kind: "output",
      data: "legacy bridge output",
    });
  });

  it("falls back to the raw body when an error frame is not valid JSON", () => {
    expect(decodeFrame("enot json")).toEqual({ kind: "error", message: "not json" });
  });
});
