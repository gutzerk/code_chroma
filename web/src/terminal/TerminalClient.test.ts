import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFrame, WebSocketTerminalClient } from "./TerminalClient";

describe("WebSocketTerminalClient.connect", () => {
  const urls: string[] = [];
  class FakeSocket {
    constructor(url: string) {
      urls.push(url);
    }
    addEventListener(): void {}
    send(): void {}
    close(): void {}
  }

  afterEach(() => {
    urls.length = 0;
    vi.unstubAllGlobals();
  });

  it("puts a measured size on the query", () => {
    vi.stubGlobal("WebSocket", FakeSocket);

    new WebSocketTerminalClient("ws://bridge").connect("claude", "wt-1", { rows: 30, cols: 100 });

    expect(urls).toEqual(["ws://bridge/ws/terminal?agent=claude&workspace=wt-1&rows=30&cols=100"]);
  });

  it("leaves the size off when none is known", () => {
    vi.stubGlobal("WebSocket", FakeSocket);

    new WebSocketTerminalClient("ws://bridge").connect("shell");

    expect(urls).toEqual(["ws://bridge/ws/terminal?agent=shell"]);
  });
});

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
