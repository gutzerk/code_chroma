import { afterEach, describe, expect, it, vi } from "vitest";
import { flagDiagramsReady } from "./agentDiagramsReady";
import { agentStore } from "./agentStore";
import type { EngineClient } from "../engine-client/EngineClient";
import type { DiagramsStatus } from "../state/types";

function clientWith(status: DiagramsStatus | Error): EngineClient {
  return {
    getDiagramsStatus: async () => {
      if (status instanceof Error) throw status;
      return status;
    },
  } as unknown as EngineClient;
}

describe("flagDiagramsReady", () => {
  afterEach(() => {
    agentStore.reset();
  });

  it("badges an agent whose own workspace holds a drawn diagram", async () => {
    const makeClient = vi.fn(() => clientWith({ patterns: { ready: true }, c1: { ready: false } }));

    await flagDiagramsReady("agent-7", makeClient);

    expect(agentStore.getDiagramsReady().has("agent-7")).toBe(true);
    expect(makeClient).toHaveBeenCalledWith("agent-7");
  });

  it("leaves an agent unbadged when nothing was drawn in its workspace", async () => {
    await flagDiagramsReady("agent-7", () => clientWith({ c1: { ready: false } }));

    expect(agentStore.getDiagramsReady().has("agent-7")).toBe(false);
  });

  it("skips the check when the canvas is already drawing that agent's workspace", async () => {
    // There DrawDiagramButton's own watcher adds the diagram, so a badge would be pure noise.
    agentStore.setActiveWorkspace("agent-7");
    const makeClient = vi.fn(() => clientWith({ patterns: { ready: true } }));

    await flagDiagramsReady("agent-7", makeClient);

    expect(makeClient).not.toHaveBeenCalled();
    expect(agentStore.getDiagramsReady().has("agent-7")).toBe(false);
  });

  it("stays silent when the forked workspace cannot answer", async () => {
    await flagDiagramsReady("agent-7", () => clientWith(new Error("workspace gone")));

    expect(agentStore.getDiagramsReady().has("agent-7")).toBe(false);
  });
});
