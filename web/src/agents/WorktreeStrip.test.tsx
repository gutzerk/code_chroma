import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentClientProvider } from "./AgentClientContext";
import type { AgentClient } from "./agentClient";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { agentStore } from "./agentStore";
import { WorktreeStrip } from "./WorktreeStrip";
import { worktreeStore } from "./worktreeStore";
import type { AgentRecord, WorktreeRecord } from "../state/types";

const TABS: WorktreeRecord[] = [
  { id: "br_1", name: "wt-1", branch: "wt-1", worktree: "/w/wt-1", dirty: 3 },
  { id: "br_2", name: "wt-2", branch: "wt-2", worktree: "/w/wt-2", dirty: 0 },
];

function client(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    ...PR_CLIENT_STUB,
    listWorktrees: async () => ({ branches: TABS, active: "br_1" }),
    activateWorkspace: async (id: string) => ({ id, state: "ready" as const, progress: "", error: null }),
    ...overrides,
  } as unknown as AgentClient;
}

function renderStrip(c: AgentClient) {
  return render(
    <AgentClientProvider client={c}>
      <WorktreeStrip />
    </AgentClientProvider>,
  );
}

function agentOn(workspace: string): AgentRecord {
  return { id: "a1", title: "a1", workspace, worktree: "/w", window: { x: 0, y: 0, width: 300, height: 300, minimized: false, z: 1 } } as unknown as AgentRecord;
}

beforeEach(() => {
  window.localStorage.clear();
  agentStore.reset();
  worktreeStore.reset();
  worktreeStore.setList(TABS, "br_1");
  agentStore.setActiveWorkspace("br_1");
});

afterEach(cleanup);

describe("WorktreeStrip", () => {
  it("renders a tab per worktree with the active one selected", () => {
    renderStrip(client());

    expect(screen.getByRole("tab", { name: "wt-1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "wt-2" }).getAttribute("aria-selected")).toBe("false");
  });

  it("switches tabs and persists the choice", async () => {
    const setActiveWorktree = vi.fn(async () => {});
    renderStrip(client({ setActiveWorktree }));

    fireEvent.click(screen.getByRole("tab", { name: "wt-2" }));

    expect(agentStore.getActiveWorkspace()).toBe("br_2");
    expect(setActiveWorktree).toHaveBeenCalledWith("br_2");
  });

  it("plus creates a worktree, shows busy meanwhile and selects the new tab", async () => {
    let release: () => void = () => {};
    const createWorktree = vi.fn(
      () =>
        new Promise<{ branch: WorktreeRecord; fetched: boolean; warning: null }>((resolve) => {
          release = () => resolve({ branch: { id: "br_3", name: "wt-3", branch: "wt-3", worktree: "/w/wt-3" }, fetched: true, warning: null });
        }),
    );
    renderStrip(client({ createWorktree }));

    fireEvent.click(screen.getByTestId("worktree-add"));
    const busy = (screen.getByTestId("worktree-add") as HTMLButtonElement).disabled;
    await act(async () => release());

    expect(busy).toBe(true);
    await waitFor(() => expect(screen.getByRole("tab", { name: "wt-3" })).toBeTruthy());
    expect(agentStore.getActiveWorkspace()).toBe("br_3");
  });

  it("renames inline and shows a 409 message inline on a duplicate", async () => {
    const renameWorktree = vi
      .fn<(id: string, name: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("name already in use"))
      .mockResolvedValueOnce(undefined);
    renderStrip(client({ renameWorktree }));

    fireEvent.doubleClick(screen.getByRole("tab", { name: "wt-1" }));
    const input = screen.getByTestId("worktree-rename-input");
    fireEvent.change(input, { target: { value: "wt-2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const error = await screen.findByTestId("worktree-rename-error");
    fireEvent.change(screen.getByTestId("worktree-rename-input"), { target: { value: "login" } });
    fireEvent.keyDown(screen.getByTestId("worktree-rename-input"), { key: "Enter" });

    expect(error.textContent).toBe("name already in use");
    await waitFor(() => expect(screen.getByRole("tab", { name: "login" })).toBeTruthy());
  });

  it("close dialog shows dirty count and attached agents, Keep closes without deleting", async () => {
    const closeWorktree = vi.fn(async () => {});
    agentStore.upsert(agentOn("br_1"));
    renderStrip(client({ closeWorktree }));

    fireEvent.click(screen.getByTestId("worktree-close-br_1"));
    const dirty = screen.getByTestId("close-worktree-dirty").textContent;
    const agents = screen.getByTestId("close-worktree-agents").textContent;
    fireEvent.click(screen.getByTestId("close-worktree-keep"));

    expect(dirty).toContain("3 uncommitted changes");
    expect(agents).toContain("1 attached agent will be closed");
    await waitFor(() => expect(closeWorktree).toHaveBeenCalledWith("br_1", false));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "wt-1" })).toBeNull());
  });

  it("Delete worktree closes with worktree_too", async () => {
    const closeWorktree = vi.fn(async () => {});
    renderStrip(client({ closeWorktree }));

    fireEvent.click(screen.getByTestId("worktree-close-br_2"));
    fireEvent.click(screen.getByTestId("close-worktree-delete"));

    await waitFor(() => expect(closeWorktree).toHaveBeenCalledWith("br_2", true));
  });

  it("remembers the choice with don't ask again and skips the dialog next time", async () => {
    const closeWorktree = vi.fn(async () => {});
    renderStrip(client({ closeWorktree }));

    fireEvent.click(screen.getByTestId("worktree-close-br_2"));
    fireEvent.click(screen.getByTestId("close-worktree-dont-ask"));
    fireEvent.click(screen.getByTestId("close-worktree-delete"));
    await waitFor(() => expect(closeWorktree).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("worktree-close-br_1"));

    await waitFor(() => expect(closeWorktree).toHaveBeenLastCalledWith("br_1", true));
    expect(screen.queryByTestId("close-worktree-dialog")).toBeNull();
  });
});
