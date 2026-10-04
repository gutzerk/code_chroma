import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentRecord, PrPreflight } from "../state/types";
import { AgentClientProvider } from "./AgentClientContext";
import type { AgentClient } from "./agentClient";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { agentStore } from "./agentStore";
import { CreatePrButton } from "./CreatePrButton";

function record(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "refund-flow",
    title: "refund flow",
    kind: "claude",
    branch: "agent/refund-flow",
    base_branch: "main",
    worktree: "/tmp/worktrees/refund-flow",
    created_at: "2026-07-28T10:00:00Z",
    session_id: null,
    pr_url: null,
    pid: null,
    window: { x: 0, y: 0, width: 720, height: 480, minimized: false, z: 1 },
    status: "idle",
    exit_code: null,
    worktree_lost: false,
    ...overrides,
  };
}

function agentClient(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    ...PR_CLIENT_STUB,
    list: async () => ({ agents: [], active_workspace: "main", max_agents: 5 }),
    create: async () => record(),
    start: async () => record(),
    stop: async () => record(),
    remove: async () => {},
    saveWindow: async () => {},
    prPreflight: async () => ({ ready: true, reason: null, dirty: [] }),
    createPr: async () => ({ ...record(), pr_url: "https://github.com/acme/app/pull/9" }),
    recreateWorktree: async () => record(),
    activateWorkspace: async (id) => ({ id, state: "ready" as const, progress: "", error: null }),
    workspaceStatus: async (id) => ({ id, state: "ready" as const, progress: "", error: null }),
    gitPreflight: async () => ({ state: "ready" as const, root: "/repo" }),
    gitInit: async () => ({ state: "ready", created_repo: true, created_gitignore: true }),
    getBranch: async () => ({ current: "main", branches: ["main"] }),
    switchBranch: async (branch: string) => ({ current: branch, branches: ["main"] }),
    updateBranch: async () => ({ current: "main", branches: ["main"] }),
    ...overrides,
  };
}

function renderButton(agent: AgentRecord, client: AgentClient) {
  return render(
    <AgentClientProvider client={client}>
      <CreatePrButton agent={agent} />
    </AgentClientProvider>,
  );
}

async function withPreflight(agent: AgentRecord, preflight: PrPreflight, extra = {}) {
  renderButton(agent, agentClient({ prPreflight: async () => preflight, ...extra }));
  await vi.waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
}

beforeEach(() => {
  agentStore.reset();
});

afterEach(cleanup);

describe("the disabled states name their reason", () => {
  it.each([
    ["gh-missing", "GitHub CLI required"],
    ["not-authenticated", "Log in: gh auth login"],
    ["not-github", "Could not detect a GitHub repository; check that `gh repo view` works here"],
    ["no-commits", "The agent hasn't committed anything yet"],
  ])("%s renders as %s", async (reason, text) => {
    await withPreflight(record(), { ready: false, reason, text, dirty: [] });

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(text);
  });
});

describe("an existing PR", () => {
  it("replaces the button with a link, rather than offering a second one", async () => {
    renderButton(record({ pr_url: "https://github.com/acme/app/pull/123" }), agentClient());

    const link = await screen.findByRole("link");
    expect(link).toHaveTextContent("PR #123");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is surfaced from preflight too, so a PR opened elsewhere still shows", async () => {
    renderButton(
      record(),
      agentClient({
        prPreflight: async () => ({
          ready: false,
          reason: "pr-exists",
          pr_url: "https://github.com/acme/app/pull/7",
          dirty: [],
        }),
      }),
    );

    expect(await screen.findByRole("link")).toHaveTextContent("PR #7");
  });
});

describe("uncommitted changes", () => {
  it("creates the PR straight away when the worktree is clean", async () => {
    const calls: boolean[] = [];
    await withPreflight(record(), { ready: true, reason: null, dirty: [] }, {
      createPr: async (_id: string, commitDirty: boolean) => {
        calls.push(commitDirty);
        return { ...record(), pr_url: "https://github.com/acme/app/pull/9" };
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create PR" }));
    await vi.waitFor(() => expect(calls).toEqual([false]));

    expect(screen.queryByTestId("pr-dirty-dialog")).not.toBeInTheDocument();
  });

  it("forces an explicit choice, never a silent push", async () => {
    await withPreflight(record(), { ready: true, reason: null, dirty: ["late.py"] });

    fireEvent.click(screen.getByRole("button", { name: "Create PR" }));

    const dialog = screen.getByTestId("pr-dirty-dialog");
    expect(dialog).toHaveTextContent("late.py");
    expect(dialog).toHaveTextContent("Create PR without them");
    expect(dialog).toHaveTextContent("Commit them, then create");
  });

  it("passes commit_dirty true when the user chooses to commit them", async () => {
    const calls: boolean[] = [];
    await withPreflight(record(), { ready: true, reason: null, dirty: ["late.py"] }, {
      createPr: async (_id: string, commitDirty: boolean) => {
        calls.push(commitDirty);
        return { ...record(), pr_url: "https://github.com/acme/app/pull/9" };
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create PR" }));
    fireEvent.click(screen.getByRole("button", { name: "Commit them, then create" }));
    await vi.waitFor(() => expect(calls).toEqual([true]));
  });

  it("passes commit_dirty false when the user chooses to leave them out", async () => {
    const calls: boolean[] = [];
    await withPreflight(record(), { ready: true, reason: null, dirty: ["late.py"] }, {
      createPr: async (_id: string, commitDirty: boolean) => {
        calls.push(commitDirty);
        return { ...record(), pr_url: "https://github.com/acme/app/pull/9" };
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create PR" }));
    fireEvent.click(screen.getByRole("button", { name: "Create PR without them" }));
    await vi.waitFor(() => expect(calls).toEqual([false]));
  });
});

describe("no merge path", () => {
  it("offers no local merge — handing off is a PR or nothing", async () => {
    await withPreflight(record(), { ready: true, reason: null, dirty: [] });

    expect(screen.queryByText(/merge/i)).not.toBeInTheDocument();
  });
});
