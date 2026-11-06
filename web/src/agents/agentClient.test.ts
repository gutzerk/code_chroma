import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAgentClient } from "./agentClient";

describe("HttpAgentClient question routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["answerQuestion", "answer"],
    ["skipQuestion", "skip"],
    ["reviseQuestion", "revise"],
    ["requestQuestionDiagram", "request-diagram"],
  ] as const)("%s encodes the question id into the path", async (method, action) => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpAgentClient("http://bridge");

    await (client[method] as (id: string, questionId: string, body?: unknown) => Promise<unknown>)("asker", "q/1?x", {});

    expect(fetchMock.mock.calls[0][0]).toBe(`http://bridge/agents/asker/questions/q%2F1%3Fx/${action}`);
  });
});
