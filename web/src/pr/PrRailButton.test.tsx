import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PrRailButton } from "./PrRailButton";
import { prStore } from "./prStore";
import { AgentClientProvider } from "../agents/AgentClientContext";
import { agentStore } from "../agents/agentStore";
import { workspaceStore } from "../agents/workspaceStore";
import { PR_CLIENT_STUB } from "../agents/stubAgentClient";
import type { AgentClient } from "../agents/agentClient";
import type { PrWorkspace } from "../state/types";

function pr(number: number): PrWorkspace {
  return {
    id: `pr-${number}`,
    number,
    title: "Add refunds",
    url: "",
    author: "octocat",
    state: "OPEN",
    head_ref: "feature/refunds",
    head_sha: "abc1234",
    head_repo: "",
    is_fork: false,
    base_ref: "main",
    worktree: "/wt",
    imported_at: "",
    fetched_at: "",
    changed_files: 1,
    additions: 1,
    deletions: 0,
    worktree_lost: false,
  };
}

function client(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    ...PR_CLIENT_STUB,
    list: async () => ({ agents: [], active_workspace: "main", max_agents: 5 }),
    create: async () => {
      throw new Error("unused");
    },
    start: async () => {
      throw new Error("unused");
    },
    stop: async () => {
      throw new Error("unused");
    },
    remove: async () => {},
    saveWindow: async () => {},
    prPreflight: async () => ({ ready: false, reason: "gh-missing", dirty: [] }),
    createPr: async () => {
      throw new Error("unused");
    },
    recreateWorktree: async () => {
      throw new Error("unused");
    },
    activateWorkspace: async (id: string) => ({
      id,
      state: "ready" as const,
      progress: "",
      error: null,
    }),
    workspaceStatus: async (id: string) => ({
      id,
      state: "ready" as const,
      progress: "",
      error: null,
    }),
    gitPreflight: async () => ({ state: "ready" as const, root: "/repo" }),
    gitInit: async () => ({ state: "ready", created_repo: true, created_gitignore: true }),
    getBranch: async () => ({ current: "main", branches: ["main"] }),
    switchBranch: async (branch) => ({ current: branch, branches: ["main"] }),
    updateBranch: async () => ({ current: "main", branches: ["main"] }),
    ...overrides,
  };
}

function renderButton(agentClient: AgentClient = client()) {
  return render(
    <AgentClientProvider client={agentClient}>
      <PrRailButton />
    </AgentClientProvider>,
  );
}

afterEach(() => {
  prStore.reset();
  workspaceStore.reset();
  agentStore.reset();
  vi.restoreAllMocks();
});

describe("PrRailButton", () => {
  it("names itself for the screen reader and starts unpressed", () => {
    renderButton();

    const button = screen.getByRole("button", { name: "Review a GitHub pull request" });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("carries a hover tooltip rather than a native title", () => {
    renderButton();

    const tooltip = screen.getByRole("button").querySelector(".rail-tooltip");
    expect(tooltip).toHaveTextContent("Review a GitHub pull request");
    expect(screen.getByRole("button")).not.toHaveAttribute("title");
  });

  it("opens and closes the dialog", async () => {
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Review a GitHub pull request" }));

    await waitFor(() => expect(screen.getByTestId("pr-dialog")).toBeInTheDocument());
    expect(
      screen.getByRole("button", { name: "Review a GitHub pull request" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("pr-dialog-dismiss"));

    await waitFor(() => expect(screen.queryByTestId("pr-dialog")).not.toBeInTheDocument());
  });

  it("loads the open reviews on mount, even with the dialog shut", async () => {
    renderButton(
      client({ listPrs: async () => ({ prs: [pr(7)], max_prs: 3, active_workspace: "main" }) }),
    );

    await waitFor(() => expect(prStore.has("pr-7")).toBe(true));
    expect(screen.queryByTestId("pr-dialog")).not.toBeInTheDocument();
  });

  it("that mount load is what makes a reloaded PR read-only before any toggle is pressed", async () => {
    renderButton(
      client({ listPrs: async () => ({ prs: [pr(7)], max_prs: 3, active_workspace: "pr-7" }) }),
    );
    agentStore.setActiveWorkspace("pr-7");

    await waitFor(() => expect(workspaceStore.getIsReadOnly("pr-7")).toBe(true));
  });

  it("stays quiet on a bridge without the /prs routes", async () => {
    renderButton(
      client({
        listPrs: async () => {
          throw new Error("404 Not Found");
        },
      }),
    );

    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
    expect(prStore.getAll()).toEqual([]);
  });
});
