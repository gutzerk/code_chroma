import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentPoll } from "./useAgentPoll";
import type { AgentStatus } from "../state/types";

describe("useAgentPoll", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each<AgentStatus>(["working"])("re-reads every interval while the agent is %s", (status) => {
    const read = vi.fn(() => Promise.resolve());
    renderHook(() => useAgentPoll("a1", status, true, 1000, read));

    vi.advanceTimersByTime(3000);

    expect(read).toHaveBeenCalledTimes(4);
  });

  it.each<AgentStatus>(["idle", "blocked", "done", "stopped", "error"])("reads once and never polls while the agent is %s", (status) => {
    const read = vi.fn(() => Promise.resolve());
    renderHook(() => useAgentPoll("a1", status, true, 1000, read));

    vi.advanceTimersByTime(3000);

    expect(read).toHaveBeenCalledTimes(1);
  });
});
