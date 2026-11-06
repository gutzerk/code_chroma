import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { AgentLed } from "./AgentLed";
import { agentStore } from "./agentStore";
import type { AgentRecord } from "../state/types";

const AGENT = { id: "ag1", title: "ag1", status: "working", window: { x: 0, y: 0, width: 300, height: 300, minimized: false, z: 1 } } as AgentRecord;

afterEach(() => agentStore.reset());

describe("AgentLed", () => {
  it("names the bridge's open question count in its label and follows an agent-questions update", () => {
    agentStore.upsert({ ...AGENT, open_questions: 1 });
    render(<AgentLed status="working" agentId="ag1" />);

    act(() => agentStore.setOpenQuestions("ag1", 2));

    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Needs you · 2 questions");
  });

  it("keeps the count when a status payload without it replaces the card", () => {
    agentStore.upsert({ ...AGENT, open_questions: 2 });
    render(<AgentLed status="working" agentId="ag1" />);

    act(() => agentStore.upsert({ ...AGENT, status: "idle" }));

    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Needs you · 2 questions");
  });

  it.each([
    ["blocked", "?"],
    ["error", "!"],
  ] as const)("draws the %s icon with its glyph", (status, glyph) => {
    render(<AgentLed status={status} agentId="quiet" size="icon" />);

    expect(screen.getByTestId(`agent-led-${status}`)).toHaveTextContent(glyph);
  });

  it("labels a stopped agent with its status", () => {
    render(<AgentLed status="stopped" agentId="quiet" />);

    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Stopped");
  });
});
