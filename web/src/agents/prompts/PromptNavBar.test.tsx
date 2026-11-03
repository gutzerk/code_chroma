import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PromptNavBar } from "./PromptNavBar";
import { PromptMarkers } from "./PromptMarkers";
import { promptNavStore, type PromptViewport } from "./promptNavStore";
import { PROMPT_NAV_SCOPE, usePromptHotkeys } from "./usePromptHotkeys";
import { ActivityPanel } from "../ActivityPanel";
import { agentStore } from "../agentStore";
import { AgentClientProvider } from "../AgentClientContext";
import { MockAgentClient } from "../mockAgentClient";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { MockBridgeEngineClient } from "../../engine-client/mockBridge";
import { layoutStore } from "../../canvas/layout/layoutStore";
import { workflowStore } from "../../workflows/workflowStore";

vi.mock("../AgentTerminal", () => ({
  AgentTerminal: ({ workspace }: { workspace: string }) => <div data-testid={`terminal-${workspace}`} />,
}));
vi.mock("../../workflows/WorkflowsTab", () => ({ WorkflowsTab: () => null }));

const raw = (text: string, edits = 0, runs = 0) => ({ id: text, text, createdAt: "2026-11-03T14:02:00Z", edits, runs });
const TEXTS = ["Fix the token refresh race", "Add a test for two requests", "Why a lock and not a future?"];

let view: PromptViewport & { scrollToLine: ReturnType<typeof vi.fn> };

function Harness({ full = false }: { full?: boolean }) {
  usePromptHotkeys();
  return (
    <div {...{ [PROMPT_NAV_SCOPE]: "a" }}>
      <PromptNavBar agentId="a" full={full} />
      <PromptMarkers agentId="a" />
      <textarea aria-label="Other field" />
      <button type="button">Inside</button>
    </div>
  );
}

function seed(texts = TEXTS) {
  promptNavStore.setPrompts("a", texts.map((t) => raw(t)));
  promptNavStore.setLayout("a", texts.map((_, i) => i * 40), 200);
}

beforeEach(() => {
  promptNavStore.reset();
  agentStore.reset();
  layoutStore.reset();
  workflowStore.reset();
  view = { scrollToLine: vi.fn(), scrollToBottom: vi.fn(), highlight: vi.fn() };
  promptNavStore.attach("a", view);
});
afterEach(cleanup);

describe("PromptNavBar (compact)", () => {
  it("shows nothing without prompts", () => {
    render(<Harness />);

    expect(screen.queryByTestId("prompt-nav-a")).toBeNull();
    expect(screen.queryByTestId("prompt-markers-a")).toBeNull();
  });

  it("shows the current prompt and its position, with Next disabled on the last", () => {
    seed();
    render(<Harness />);

    const bar = screen.getByTestId("prompt-nav-a");
    expect(within(bar).getByText("3 / 3")).toBeVisible();
    expect(within(bar).getByText(TEXTS[2])).toBeVisible();
    expect(within(bar).getByRole("button", { name: "Next prompt" })).toBeDisabled();
    expect(within(bar).getByRole("button", { name: "Previous prompt" })).toBeEnabled();
  });

  it("disables both arrows with a single prompt", () => {
    seed(["only one"]);
    render(<Harness />);

    expect(screen.getByRole("button", { name: "Previous prompt" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next prompt" })).toBeDisabled();
  });

  it("scrolls to the previous prompt from the arrow button and announces it", () => {
    seed();
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Previous prompt" }));

    expect(view.scrollToLine).toHaveBeenCalledWith(40);
    expect(screen.getByText("Prompt 2 of 3")).toHaveAttribute("aria-live", "polite");
  });

  it("steps with Alt+arrows when focus is inside the agent panel", () => {
    seed();
    render(<Harness />);
    screen.getByRole("button", { name: "Inside" }).focus();

    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp", altKey: true });

    expect(view.scrollToLine).toHaveBeenLastCalledWith(0);
  });

  it("leaves Alt+arrows to another text field", () => {
    seed();
    render(<Harness />);
    screen.getByRole("textbox", { name: "Other field" }).focus();

    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp", altKey: true });

    expect(view.scrollToLine).not.toHaveBeenCalled();
  });

  it("jumps from a marker on the edge", () => {
    seed();
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Jump to prompt 1" }));

    expect(view.scrollToLine).toHaveBeenCalledWith(0);
    expect(screen.getByRole("button", { name: "Jump to prompt 1" })).toHaveAttribute("aria-current", "true");
  });

  it("opens the list, filters it, and shows the empty state", () => {
    seed();
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /All my prompts/ }));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "TOKEN" } });
    const filtered = screen.getAllByRole("option").map((o) => o.textContent);
    fireEvent.change(input, { target: { value: "zzz" } });

    expect(filtered).toEqual([expect.stringContaining(TEXTS[0])]);
    expect(screen.getByText("No prompts match")).toBeVisible();
  });

  it("moves through the list with arrows and jumps with Enter", () => {
    seed();
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /All my prompts/ }));
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(view.scrollToLine).toHaveBeenCalledWith(40);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on Esc and returns focus to the trigger", () => {
    seed();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /All my prompts/ });

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("opens the list on Cmd/Ctrl+Shift+P", () => {
    seed();
    render(<Harness />);
    screen.getByRole("button", { name: "Inside" }).focus();

    fireEvent.keyDown(document.activeElement!, { key: "P", code: "KeyP", ctrlKey: true, shiftKey: true });

    expect(screen.getByRole("listbox", { name: "My prompts" })).toBeVisible();
  });
});

describe("PromptNavBar (full screen)", () => {
  it("jumps to the latest output and shows labelled Prev/Next", () => {
    seed();
    render(<Harness full />);

    fireEvent.click(screen.getByRole("button", { name: "Latest" }));

    expect(view.scrollToBottom).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Previous prompt" })).toHaveTextContent("Prev");
  });

  it("lists the selected agent's prompts under the agent list and jumps from it", async () => {
    const client = new MockAgentClient();
    const agent = await client.create("Planner");
    const started = await client.start(agent.id);
    const withPrompts = Object.assign(client, {
      prompts: vi.fn().mockResolvedValue({ prompts: [raw(TEXTS[0], 1, 1), raw(TEXTS[1])] }),
    });
    const target: PromptViewport & { scrollToLine: ReturnType<typeof vi.fn> } = { scrollToLine: vi.fn(), scrollToBottom: vi.fn(), highlight: vi.fn() };
    promptNavStore.attach(started.id, target);
    agentStore.upsert(started);
    layoutStore.setAgentsMode("full");
    render(
      <AgentClientProvider client={withPrompts}>
        <EngineClientProvider repoId="main" client={new MockBridgeEngineClient()}>
          <ActivityPanel onRunAgent={() => {}} />
        </EngineClientProvider>
      </AgentClientProvider>,
    );
    const outline = await screen.findByTestId(`prompt-outline-${started.id}`);
    act(() => promptNavStore.setLayout(started.id, [5, 30], 100));

    fireEvent.click(within(outline).getByRole("option", { name: new RegExp(TEXTS[0]) }));

    expect(within(outline).getByText(/Your prompts · 2/)).toBeVisible();
    expect(within(outline).getByText(/1 edit, 1 run/)).toBeVisible();
    expect(target.scrollToLine).toHaveBeenCalledWith(5);
    expect(screen.getByTestId(`prompt-nav-${started.id}`)).toHaveTextContent("1 / 2");
  });
});
