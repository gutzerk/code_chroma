import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AgentLed } from "./AgentLed";
import { canvasDocStore } from "../canvas/doc/canvasDocStore";
import { useLoadCanvasDoc } from "../canvas/doc/canvasDocSync";
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

    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Needs you · 2 questions"));
  });

  it.each([
    ["blocked", "?"],
    ["error", "!"],
  ] as const)("draws the %s icon with its glyph", (status, glyph) => {
    render(<AgentLed status={status} agentId="quiet" size="icon" />);

    expect(screen.getByTestId(`agent-led-${status}`)).toHaveTextContent(glyph);
  });

  it("shows a legacy exited status with no exit code as stopped", () => {
    render(<AgentLed status="exited" agentId="quiet" />);

    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Stopped");
  });
});
