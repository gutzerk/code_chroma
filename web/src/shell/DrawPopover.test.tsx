import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentClientProvider } from "../agents/AgentClientContext";
import type { AgentClient } from "../agents/agentClient";
import { agentStore } from "../agents/agentStore";
import { PR_CLIENT_STUB } from "../agents/stubAgentClient";
import { DrawPopover } from "./DrawPopover";

afterEach(() => {
  cleanup();
  agentStore.reset();
});

function renderPopover(onPick: () => void) {
  return render(
    <AgentClientProvider client={PR_CLIENT_STUB as unknown as AgentClient}>
      <DrawPopover onPick={onPick} />
    </AgentClientProvider>,
  );
}

describe("DrawPopover", () => {
  it("lists the five kinds", () => {
    renderPopover(() => {});

    const labels = screen.getAllByRole("menuitem").map((b) => b.textContent);

    expect(labels).toEqual(["C1 · system context", "Patterns", "Impact", "Epics", "Custom…"]);
  });

  it("reports the picked kind through onPick", () => {
    const onPick = vi.fn();
    renderPopover(onPick);

    fireEvent.click(screen.getByTestId("draw-popover-impact"));

    expect(onPick).toHaveBeenCalledWith("impact");
  });

  it("by default launches an agent whose task names the picked kind", async () => {
    const create = vi.fn(async (..._args: unknown[]) => ({
      id: "a1", title: "a1", kind: "claude" as const, branch: "agent/a1", base_branch: "main",
      worktree: "/tmp/a1", created_at: "2026-01-01T00:00:00Z", session_id: null, pr_url: null, pid: null,
      window: { x: 0, y: 0, width: 720, height: 480, minimized: false, z: 1 },
      status: "starting" as const, exit_code: null, worktree_lost: false,
    }));
    const client = {
      ...PR_CLIENT_STUB,
      create,
      start: create,
      gitPreflight: async () => ({ state: "ready" as const, root: "/repo" }),
    } as unknown as AgentClient;
    render(
      <AgentClientProvider client={client}>
        <DrawPopover />
      </AgentClientProvider>,
    );

    fireEvent.click(screen.getByTestId("draw-popover-patterns"));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(JSON.stringify(create.mock.calls[0])).toContain("design patterns");
  });
});
