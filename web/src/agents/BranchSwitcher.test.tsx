import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentClientProvider } from "./AgentClientContext";
import type { AgentClient } from "./agentClient";
import { PR_CLIENT_STUB } from "./stubAgentClient";
import { agentStore } from "./agentStore";
import { branchStore } from "./branchStore";
import { BranchSwitcher } from "./BranchSwitcher";

function agentClient(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    ...PR_CLIENT_STUB,
    list: async () => ({ agents: [], active_workspace: "main", max_agents: 5 }),
    create: async () => {
      throw new Error("not used in this test");
    },
    start: async () => {
      throw new Error("not used in this test");
    },
    stop: async () => {
      throw new Error("not used in this test");
    },
    remove: async () => {},
    saveWindow: async () => {},
    prPreflight: async () => ({ ready: false, reason: "gh-missing", text: "GitHub CLI required", dirty: [] }),
    createPr: async () => {
      throw new Error("not used in this test");
    },
    recreateWorktree: async () => {
      throw new Error("not used in this test");
    },
    activateWorkspace: async (id) => ({ id, state: "ready" as const, progress: "", error: null }),
    workspaceStatus: async (id) => ({ id, state: "ready" as const, progress: "", error: null }),
    gitPreflight: async () => ({ state: "ready" as const, root: "/repo" }),
    gitInit: async () => ({ state: "ready", created_repo: true, created_gitignore: true }),
    getBranch: async () => ({ current: "main", branches: ["main", "feature-x"] }),
    switchBranch: async (branch) => ({ current: branch, branches: ["main", "feature-x"] }),
    updateBranch: async () => ({ current: "main", branches: ["main", "feature-x"] }),
    ...overrides,
  };
}

function renderSwitcher(client: AgentClient = agentClient()) {
  return render(
    <AgentClientProvider client={client}>
      <BranchSwitcher />
    </AgentClientProvider>,
  );
}

beforeEach(() => {
  agentStore.reset();
  branchStore.reset();
  branchStore.setBranch({ current: "main", branches: ["main", "feature-x"] });
});

afterEach(() => {
  cleanup();
  agentStore.reset();
  branchStore.reset();
});

describe("BranchSwitcher", () => {
  it("names the current branch in its accessible label", () => {
    renderSwitcher();

    expect(screen.getByRole("button", { name: "Branch: main" })).toBeInTheDocument();
  });

  it("shows the current branch name beside the branch button", () => {
    renderSwitcher();

    expect(screen.getByTestId("branch-switcher-name")).toHaveTextContent("main");
  });

  it("opens a list of every local branch on click", async () => {
    renderSwitcher();

    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));

    const list = await screen.findByTestId("branch-switcher-list");
    expect(list).toHaveTextContent("main");
    expect(list).toHaveTextContent("feature-x");
  });

  it("reflects the dropdown's open state on the trigger's aria-expanded", async () => {
    renderSwitcher();
    const trigger = screen.getByRole("button", { name: "Branch: main" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    renderSwitcher();
    const trigger = screen.getByRole("button", { name: "Branch: main" });
    fireEvent.click(trigger);
    await screen.findByTestId("branch-switcher-list");

    fireEvent.keyDown(screen.getByTestId("branch-switcher-list"), { key: "Escape" });

    expect(screen.queryByTestId("branch-switcher-list")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("re-reads the branch list from the bridge every time it opens, not just at mount", async () => {
    let call = 0;
    const client = agentClient({
      getBranch: async () => {
        call += 1;
        return call === 1
          ? { current: "main", branches: ["main"] }
          : { current: "main", branches: ["main", "just-created"] };
      },
    });
    renderSwitcher(client);
    const trigger = screen.getByRole("button", { name: "Branch: main" });
    fireEvent.click(trigger);
    await screen.findByTestId("branch-switcher-list");
    fireEvent.click(trigger);

    fireEvent.click(trigger);

    const list = await screen.findByTestId("branch-switcher-list");
    expect(list).toHaveTextContent("just-created");
  });

  it("checks out the picked branch and updates the store", async () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));

    fireEvent.click(screen.getByRole("button", { name: "feature-x" }));

    await screen.findByRole("button", { name: "Branch: feature-x" });
    expect(branchStore.getCurrent()).toBe("feature-x");
  });

  it("shows the bridge's error in a blocking modal rather than failing silently", async () => {
    renderSwitcher(
      agentClient({
        switchBranch: async () => {
          throw new Error("commit or stash your changes before switching branches");
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));

    fireEvent.click(screen.getByRole("button", { name: "feature-x" }));

    const dialog = await screen.findByRole("dialog", { name: "Branch switch failed" });
    expect(dialog).toHaveTextContent("commit or stash your changes before switching branches");
    expect(branchStore.getCurrent()).toBe("main");

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog", { name: "Branch switch failed" })).not.toBeInTheDocument();
  });

  // Used to disable itself here: only main's own tree is ever checked out, and an agent's worktree
  // is untouched by that, so being focused on an agent was never a reason to refuse.
  it("stays usable while an agent's own workspace, not main, is active", async () => {
    agentStore.setActiveWorkspace("refund-flow");
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));

    fireEvent.click(screen.getByRole("button", { name: "feature-x" }));

    await screen.findByRole("button", { name: "Branch: feature-x" });
    expect(branchStore.getCurrent()).toBe("feature-x");
  });

  it("updates the current branch from its upstream and keeps the same branch checked out", async () => {
    const client = agentClient({
      updateBranch: async () => ({ current: "main", branches: ["main", "feature-x"] }),
    });
    renderSwitcher(client);
    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));
    await screen.findByTestId("branch-switcher-list");

    fireEvent.click(screen.getByTestId("branch-switcher-update"));

    await waitFor(() => expect(branchStore.getCurrent()).toBe("main"));
    expect(branchStore.getBranches()).toContain("feature-x");
  });

  it("surfaces an update failure in the blocking modal, leaving the branch alone", async () => {
    const client = agentClient({
      updateBranch: async () => {
        throw new Error("fatal: the current branch has no upstream branch");
      },
    });
    renderSwitcher(client);
    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));
    await screen.findByTestId("branch-switcher-list");

    fireEvent.click(screen.getByTestId("branch-switcher-update"));

    const dialog = await screen.findByRole("dialog", { name: "Branch update failed" });
    expect(dialog).toHaveTextContent("has no upstream branch");
    expect(branchStore.getCurrent()).toBe("main");
  });
});
