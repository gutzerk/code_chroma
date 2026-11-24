import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentClientProvider } from "../AgentClientContext";
import { MockAgentClient } from "../mockAgentClient";
import { LONG_PRESS_MS, RunAgentButton } from "./RunAgentButton";

function setup(onRunAgent = vi.fn()) {
  render(
    <AgentClientProvider client={new MockAgentClient()}>
      <RunAgentButton disabled={false} onRunAgent={onRunAgent} />
    </AgentClientProvider>,
  );
  return { onRunAgent, button: screen.getByRole("button", { name: "Run agent" }) };
}

async function hold(button: HTMLElement, ms: number) {
  fireEvent.pointerDown(button, { button: 0 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  fireEvent.pointerUp(button);
  fireEvent.click(button);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RunAgentButton", () => {
  it("runs the configured model on a plain click", async () => {
    const { onRunAgent, button } = setup();

    await hold(button, 100);

    expect(onRunAgent).toHaveBeenCalledWith();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("drops the model list under the button after a one-second hold, without launching", async () => {
    const { onRunAgent, button } = setup();

    await hold(button, LONG_PRESS_MS);

    expect(onRunAgent).not.toHaveBeenCalled();
    expect(screen.getByRole("menu", { name: "Model for the new agent" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "sonnet" })).toBeVisible();
  });

  it("launches the agent on the model picked from the list", async () => {
    const { onRunAgent, button } = setup();
    await hold(button, LONG_PRESS_MS);

    fireEvent.click(screen.getByRole("menuitem", { name: "haiku" }));

    expect(onRunAgent).toHaveBeenCalledWith("haiku");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the list from the keyboard with ArrowDown", async () => {
    const { button } = setup();

    fireEvent.keyDown(button, { key: "ArrowDown" });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(screen.getByRole("menu")).toBeVisible();
  });

  it("closes the list on Escape", async () => {
    const { button } = setup();
    await hold(button, LONG_PRESS_MS);

    fireEvent.keyDown(button, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
