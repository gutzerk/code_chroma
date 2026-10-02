import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { HttpEngineClient } from "./EngineClient";
import { stubWebSocket, type FakeSocket } from "./fakeSocket";

let sockets: FakeSocket[];

beforeEach(() => {
  sockets = stubWebSocket();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("live pings are filtered by workspace", () => {
  it("a canvas on main takes a ping with no workspace key", () => {
    const client = new HttpEngineClient("http://bridge", "main");
    const seen: unknown[] = [];
    client.subscribe(() => seen.push("changed"));

    sockets[0].push({ type: "changed", paths: ["a.py"] });

    expect(seen).toHaveLength(1);
  });

  it("a canvas on main ignores an agent's edits", () => {
    const client = new HttpEngineClient("http://bridge", "main");
    const seen: unknown[] = [];
    client.subscribe(() => seen.push("changed"));

    sockets[0].push({ type: "changed", paths: ["a.py"], workspace: "refund-flow" });

    expect(seen).toEqual([]);
  });

  it("a canvas on an agent ignores the main repo's edits", () => {
    const client = new HttpEngineClient("http://bridge", "refund-flow");
    const seen: unknown[] = [];
    client.subscribe(() => seen.push("changed"));

    sockets[0].push({ type: "changed", paths: ["a.py"] });

    expect(seen).toEqual([]);
  });

  it("a canvas on an agent takes that agent's own edits", () => {
    const client = new HttpEngineClient("http://bridge", "refund-flow");
    const seen: unknown[] = [];
    client.subscribe(() => seen.push("changed"));

    sockets[0].push({ type: "changed", paths: ["a.py"], workspace: "refund-flow" });

    expect(seen).toHaveLength(1);
  });

  it("agent lifecycle pings reach every canvas, since the list spans workspaces", () => {
    const client = new HttpEngineClient("http://bridge", "refund-flow");
    const seen: unknown[] = [];
    client.subscribeAgents((message) => seen.push(message));

    sockets[0].push({ type: "agent-status", id: "other", status: "blocked" });

    expect(seen).toEqual([{ type: "agent-status", id: "other", status: "blocked" }]);
  });
});
