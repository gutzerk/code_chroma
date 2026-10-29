import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineClient } from "../engine-client/EngineClient";
import { withTutorialDiagramGate } from "./tutorialDiagramGate";
import { tutorialSimStore } from "./tutorialSim";
import { TUTORIAL_ROOT_NAME } from "./tutorialSteps";

afterEach(() => tutorialSimStore.disableGate());

function fakeClient(getNode: () => Promise<unknown>): EngineClient {
  return {
    getNode,
    getDiagramsStatus: async () => ({ "system-context": { ready: true } }),
  } as unknown as EngineClient;
}

describe("withTutorialDiagramGate", () => {
  it("retries detection after a failed first getNode", async () => {
    const getNode = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue({ name: TUTORIAL_ROOT_NAME });
    const client = withTutorialDiagramGate(fakeClient(getNode));

    await client.getDiagramsStatus();
    const second = await client.getDiagramsStatus();

    expect(second["system-context"].ready).toBe(false);
  });

  it("stops hiding diagrams once the gate is disabled", async () => {
    const client = withTutorialDiagramGate(
      fakeClient(async () => ({ name: TUTORIAL_ROOT_NAME })),
    );
    await client.getDiagramsStatus();

    tutorialSimStore.disableGate();
    const status = await client.getDiagramsStatus();

    expect(status["system-context"].ready).toBe(true);
  });
});
