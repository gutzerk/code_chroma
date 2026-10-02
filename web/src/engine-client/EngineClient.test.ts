import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpEngineClient } from "./EngineClient";
import { stubWebSocket } from "./fakeSocket";

/** Every *read* carries a signal (EngineClient's READ_TIMEOUT_MS, combined with the caller's own
 * abort when it has one), so every GET assertion below expects one. */
const SIGNALLED = { signal: expect.any(AbortSignal) as AbortSignal };

/** A write gets no blanket timeout — aborting a POST wouldn't undo it server-side, it would only
 * hide the outcome. Only a caller that passes its own signal puts one on a write. */
const UNSIGNALLED = { signal: undefined };

function stubFetchOnce(response: Response) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("HttpEngineClient error surfacing", () => {
  // getChildren (not getNode) exercises this: getNode's own 404 handling is deliberately different
  // (see the getNode.404 describe block below) -- a 404 there means "no such node", not an error.
  it("throws the FastAPI HTTPException's object detail.error", async () => {
    stubFetchOnce(new Response(JSON.stringify({ detail: { error: "node not found" } }), {
      status: 404,
    }));
    const client = new HttpEngineClient("http://localhost:8000", "default");

    await expect(client.getChildren("function::foo")).rejects.toThrow("node not found");
  });

  it("throws a plain string detail as-is", async () => {
    stubFetchOnce(new Response(JSON.stringify({ detail: "not found" }), { status: 404 }));
    const client = new HttpEngineClient("http://localhost:8000", "default");

    await expect(client.getChildren("function::foo")).rejects.toThrow("not found");
  });

  it("falls back to a generic status-only message when the body isn't JSON", async () => {
    stubFetchOnce(new Response("<html>gateway timeout</html>", { status: 504 }));
    const client = new HttpEngineClient("http://localhost:8000", "default");

    await expect(client.getChildren("function::foo")).rejects.toThrow("request failed (504)");
  });
});

describe("HttpEngineClient.getNode's 404 handling", () => {
  it("resolves null, not a rejection, for a 404 -- the route's own honest 'no such node' answer", async () => {
    stubFetchOnce(new Response(JSON.stringify({ detail: "unknown node: abc123" }), { status: 404 }));
    const client = new HttpEngineClient("http://localhost:8000", "default");

    await expect(client.getNode("abc123")).resolves.toBeNull();
  });

  it("still rejects on a real server error, not just a missing node", async () => {
    stubFetchOnce(new Response("boom", { status: 500 }));
    const client = new HttpEngineClient("http://localhost:8000", "default");

    await expect(client.getNode("function::foo")).rejects.toThrow();
  });
});

describe("HttpEngineClient.getDiff", () => {
  it("fetches GET /repos/{id}/diff and returns the parsed list", async () => {
    const diffs = [{ node_id: "function::foo", original_source: "a", proposed_source: "b" }];
    stubFetchOnce(new Response(JSON.stringify(diffs), { status: 200 }));
    const client = new HttpEngineClient("http://localhost:8000", "default");

    const result = await client.getDiff();

    expect(result).toEqual(diffs);
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/repos/default/diff", SIGNALLED);
  });
});

describe("HttpEngineClient.generateC1", () => {
  it("POSTs /repos/{id}/c1/generate and returns the parsed status", async () => {
    const status = { state: "generating", error: null };
    stubFetchOnce(new Response(JSON.stringify(status), { status: 200 }));
    const client = new HttpEngineClient("http://localhost:8000", "default");

    const result = await client.generateDiagram("c1");

    expect(result).toEqual(status);
    // The body is always sent -- update_instructions is a string the route strips, so an empty one
    // is just a plain generate (see EngineClient.generateDiagram). Same body the options case asserts.
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/repos/default/c1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onlyIfMissing: false, updateInstructions: "" }),
      ...UNSIGNALLED,
    });
  });

  it("POSTs the update note as a JSON body when options carry it", async () => {
    const status = { state: "generating", error: null };
    stubFetchOnce(new Response(JSON.stringify(status), { status: 200 }));
    const client = new HttpEngineClient("http://localhost:8000", "default");

    await client.generateDiagram("c1", { updateInstructions: "dropped the legacy box" });

    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/repos/default/c1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onlyIfMissing: false, updateInstructions: "dropped the legacy box" }),
      ...UNSIGNALLED,
    });
  });

  it("throws a readable message when the bridge rejects the request", async () => {
    stubFetchOnce(new Response(JSON.stringify({ detail: "boom" }), { status: 500 }));
    const client = new HttpEngineClient("http://localhost:8000", "default");

    await expect(client.generateDiagram("c1")).rejects.toThrow("boom");
  });
});

describe("HttpEngineClient.getC1Status", () => {
  it("fetches GET /repos/{id}/c1/status and returns the parsed status", async () => {
    const status = { state: "idle", error: null };
    stubFetchOnce(new Response(JSON.stringify(status), { status: 200 }));
    const client = new HttpEngineClient("http://localhost:8000", "default");

    const result = await client.getDiagramStatus("c1");

    expect(result).toEqual(status);
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/repos/default/c1/status", SIGNALLED);
  });
});

describe("HttpEngineClient skill-run progress feeds", () => {
  it("unwraps the lines out of GET /repos/{id}/c1/output", async () => {
    stubFetchOnce(new Response(JSON.stringify({ lines: ["⏺ Read(app.py)"] }), { status: 200 }));
    const client = new HttpEngineClient("http://localhost:8000", "default");

    const result = await client.getDiagramOutput("c1");

    expect(result).toEqual(["⏺ Read(app.py)"]);
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/repos/default/c1/output", SIGNALLED);
  });

  it("unwraps the lines out of GET /repos/{id}/impact-changes/output", async () => {
    stubFetchOnce(new Response(JSON.stringify({ lines: ["⏺ Bash(git diff)"] }), { status: 200 }));
    const client = new HttpEngineClient("http://localhost:8000", "default");

    const result = await client.getDiagramOutput("impact-changes");

    expect(result).toEqual(["⏺ Bash(git diff)"]);
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/repos/default/impact-changes/output", SIGNALLED);
  });

  // repoId "main": the bridge sends these with no workspace key, and absent means main.
  it("hands each socket batch's lines to the right feed's subscriber", () => {
    const sockets = stubWebSocket();
    const client = new HttpEngineClient("http://localhost:8000", "main");
    const generation: string[][] = [];
    const review: string[][] = [];

    client.subscribeDiagramOutput("c1", (lines) => generation.push(lines));
    client.subscribeDiagramOutput("impact-changes", (lines) => review.push(lines));
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "c1-output", lines: ["⏺ Glob(*)"] }) });
    sockets[0].onmessage?.({
      data: JSON.stringify({ type: "impact-changes-output", lines: ["⏺ Bash(git diff)"] }),
    });

    expect(generation).toEqual([["⏺ Glob(*)"]]);
    expect(review).toEqual([["⏺ Bash(git diff)"]]);
  });
});

describe("HttpEngineClient events-socket reconnect", () => {
  it("doubles the retry delay for a socket that keeps dropping", () => {
    vi.useFakeTimers();
    const sockets = stubWebSocket();
    const client = new HttpEngineClient("http://localhost:8000", "main");
    client.subscribe(() => {});

    sockets[0].onclose?.();
    vi.advanceTimersByTime(1000);
    sockets[1].onclose?.();
    vi.advanceTimersByTime(1000);

    // 🔴 The base delay reopened socket 1, but the next retry waits 2000ms — so one more second is
    // not enough. Without the backoff a flapping socket replayed notifyResync()'s whole refetch
    // fan-out (diff, C1 review, impact review, canvas doc, every expanded block's children) at 1Hz.
    expect(sockets).toHaveLength(2);
  });

  it("gives a connection that stayed up the base delay back", () => {
    vi.useFakeTimers();
    const sockets = stubWebSocket();
    const client = new HttpEngineClient("http://localhost:8000", "main");
    client.subscribe(() => {});

    sockets[0].onclose?.();
    vi.advanceTimersByTime(1000);
    sockets[1].onopen?.();
    vi.advanceTimersByTime(10_000);
    sockets[1].onclose?.();
    vi.advanceTimersByTime(1000);

    expect(sockets).toHaveLength(3);
  });
});

