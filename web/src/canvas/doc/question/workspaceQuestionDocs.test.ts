import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineClient } from "../../../engine-client/EngineClient";
import { EMPTY_CANVAS_DOC, type CanvasDoc, type CanvasElement } from "../../../state/types";
import { workspaceQuestionDocs } from "./workspaceQuestionDocs";

function question(state: string): CanvasElement {
  return { id: "q1", render: "question", meta: { state, agent_id: "a1", options: [] } } as unknown as CanvasElement;
}

function doc(elements: CanvasElement[]): CanvasDoc {
  return { ...EMPTY_CANVAS_DOC, elements: Object.fromEntries(elements.map((el) => [el.id, el])) };
}

/** A client whose getCanvas calls resolve only when the test says so, and whose canvas pings the test fires. */
function fakeClient() {
  const pending: Array<(doc: CanvasDoc) => void> = [];
  let ping: () => void = () => {};
  const getCanvas = vi.fn(() => new Promise<CanvasDoc>((resolve) => pending.push(resolve)));
  const client = { getCanvas, subscribeCanvas: (cb: () => void) => ((ping = cb), () => {}) } as unknown as EngineClient;
  const settle = async (next: CanvasDoc) => {
    pending.shift()?.(next);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { client, getCanvas, ping: () => ping(), settle };
}

afterEach(() => workspaceQuestionDocs.reset());

describe("workspaceQuestionDocs", () => {
  it("keeps one fetch in flight and coalesces pings into one more", async () => {
    const fake = fakeClient();
    workspaceQuestionDocs.retain(["w1"], () => fake.client);

    fake.ping();
    fake.ping();
    const whileInFlight = fake.getCanvas.mock.calls.length;
    await fake.settle(doc([]));

    expect(whileInFlight).toBe(1);
    expect(fake.getCanvas).toHaveBeenCalledTimes(2);
  });

  it("does not republish a doc whose questions did not change", async () => {
    const fake = fakeClient();
    workspaceQuestionDocs.retain(["w1"], () => fake.client);
    await fake.settle(doc([question("open")]));
    const listener = vi.fn();
    workspaceQuestionDocs.subscribe(listener);

    fake.ping();
    await fake.settle(doc([question("open"), { id: "box", render: "box", meta: {} } as unknown as CanvasElement]));

    expect(listener).not.toHaveBeenCalled();
  });

  it("republishes when a question's state changes", async () => {
    const fake = fakeClient();
    workspaceQuestionDocs.retain(["w1"], () => fake.client);
    await fake.settle(doc([question("open")]));
    const listener = vi.fn();
    workspaceQuestionDocs.subscribe(listener);

    fake.ping();
    await fake.settle(doc([question("answered")]));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(workspaceQuestionDocs.getSource("w1")?.doc?.elements.q1.meta.state).toBe("answered");
  });

  it("drops a fetch that resolves after the watch stopped", async () => {
    const fake = fakeClient();
    workspaceQuestionDocs.retain(["w1"], () => fake.client);
    workspaceQuestionDocs.retain([], () => fake.client);
    const listener = vi.fn();
    workspaceQuestionDocs.subscribe(listener);

    await fake.settle(doc([question("open")]));

    expect(listener).not.toHaveBeenCalled();
    expect(workspaceQuestionDocs.getDocs()).toEqual([]);
  });
});
