import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpEngineClient } from "../engine-client/EngineClient";
import { stubWebSocket } from "../engine-client/fakeSocket";

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("HttpEngineClient workflow routes", () => {
  it.each([
    ["pauseRun", (c: HttpEngineClient) => c.pauseRun("r1"), "/repos/default/runs/r1/pause", undefined],
    ["resumeRun", (c: HttpEngineClient) => c.resumeRun("r1"), "/repos/default/runs/r1/resume", undefined],
    ["stopRun", (c: HttpEngineClient) => c.stopRun("r1", "afterStep"), "/repos/default/runs/r1/stop", { mode: "afterStep" }],
    ["keepRunning", (c: HttpEngineClient) => c.keepRunning("r1"), "/repos/default/runs/r1/keep-running", undefined],
    ["setBreakpoint", (c: HttpEngineClient) => c.setBreakpoint("r1", "s2", true), "/repos/default/runs/r1/breakpoints", { stepId: "s2", on: true }],
    ["resumeRunFrom", (c: HttpEngineClient) => c.resumeRunFrom("r1", "s2"), "/repos/default/runs/r1/resume-from", { stepId: "s2" }],
    ["reviewRun", (c: HttpEngineClient) => c.reviewRun("r1", "approve"), "/repos/default/runs/r1/review", { decision: "approve" }],
    ["sendRunMessage", (c: HttpEngineClient) => c.sendRunMessage("r1", "s2", "hi"), "/repos/default/runs/r1/message", { target: "s2", text: "hi" }],
    ["redoRun", (c: HttpEngineClient) => c.redoRun("r1", { from: "s2", note: "n" }), "/repos/default/runs/r1/redo", { from: "s2", note: "n" }],
    ["cancelRedo", (c: HttpEngineClient) => c.cancelRedo("r1"), "/repos/default/runs/r1/redo/cancel", undefined],
    ["reviewRun with note", (c: HttpEngineClient) => c.reviewRun("r1", "sendBack", "fix"), "/repos/default/runs/r1/review", { decision: "sendBack", note: "fix" }],
    ["startRun", (c: HttpEngineClient) => c.startRun("wf"), "/repos/default/workflows/wf/runs", undefined],
  ])("%s POSTs the contract route", async (_name, call, path, body) => {
    const fetchMock = stubFetch();

    await call(new HttpEngineClient("http://localhost:8000", "default"));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://localhost:8000${path}`);
    expect(init.method).toBe("POST");
    expect(init.body === undefined ? undefined : JSON.parse(String(init.body))).toEqual(body);
  });

  it("delivers run pings to subscribeRuns", () => {
    const sockets = stubWebSocket();
    const client = new HttpEngineClient("http://localhost:8000", "main");
    const onEvent = vi.fn();
    client.subscribeRuns(onEvent);

    sockets[0].push({ type: "run", runId: "r1", event: "run.paused" });

    expect(onEvent).toHaveBeenCalledWith({ type: "run", runId: "r1", event: "run.paused" });
  });
});
