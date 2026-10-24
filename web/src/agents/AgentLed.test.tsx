import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AgentLed } from "./AgentLed";
import { canvasDocStore, useLoadCanvasDoc } from "../canvas/doc/canvasDocStore";
import { EngineClientProvider, useEngineClient } from "../engine-client/EngineClientContext";
import { MockBridgeEngineClient } from "../engine-client/mockBridge";
import type { CanvasOp } from "../state/types";

function ask(step: number): CanvasOp {
  return {
    op: "add_element", render: "question", layer: "questions", label: `Q${step}`,
    position: { x: 0, y: step * 100 },
    meta: { session_id: "s", step, total: 2, state: "open", agent_id: "ag1", options: [] },
  } as CanvasOp;
}

function Loader() {
  useLoadCanvasDoc(useEngineClient());
  return null;
}

afterEach(() => canvasDocStore.reset());

describe("AgentLed", () => {
  it("names the number of open questions in its label", async () => {
    const client = new MockBridgeEngineClient();
    await client.patchCanvas({ ops: [ask(1), ask(2)], layer: "default", explanation: "", confirm_mass_delete: false });

    render(
      <EngineClientProvider repoId="default" client={client}>
        <Loader />
        <AgentLed status="working" agentId="ag1" />
      </EngineClientProvider>,
    );

    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Working · 2 questions"));
  });
});
