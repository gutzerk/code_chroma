import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineClient } from "../engine-client/EngineClient";
import type { WorkflowDef } from "./types";
import { bindWorkflows, workflowStore } from "./workflowStore";

const def = (id: string): WorkflowDef => ({ id, name: id, steps: [] }) as unknown as WorkflowDef;

/** A client whose listWorkflows replies resolve only when the test says so. */
function fakeClient() {
  const replies: ((workflows: WorkflowDef[]) => void)[] = [];
  let ping = (): void => {};
  const client = {
    listWorkflows: vi.fn(() => new Promise<WorkflowDef[]>((resolve) => replies.push(resolve))),
    listRuns: vi.fn(async () => []),
    subscribeRuns: () => () => {},
    subscribeWorkflows: (onChange: () => void) => {
      ping = onChange;
      return () => {};
    },
  } as unknown as EngineClient;
  return { client, replies, ping: () => ping() };
}

afterEach(() => workflowStore.reset());

describe("bindWorkflows", () => {
  it("refetches a burst of workflows pings once more after the fetch in flight, so the newest list lands last", async () => {
    const { client, replies, ping } = fakeClient();
    const unbind = bindWorkflows(client);
    replies.shift()!([]);
    await vi.waitFor(() => expect(workflowStore.getWorkflows()).toEqual([]));

    ping();
    ping();
    ping();
    const callsDuringBurst = vi.mocked(client.listWorkflows).mock.calls.length;
    replies.shift()!([def("old")]);
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    replies.shift()!([def("old"), def("new")]);
    await vi.waitFor(() => expect(workflowStore.getWorkflows()).toHaveLength(2));
    unbind();

    expect(callsDuringBurst).toBe(2);
    expect(workflowStore.getWorkflows().map((w) => w.id)).toEqual(["old", "new"]);
  });
});
