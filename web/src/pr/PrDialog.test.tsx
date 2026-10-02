import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PrDialog } from "./PrDialog";
import { prStore } from "./prStore";
import { AgentClientProvider } from "../agents/AgentClientContext";
import { agentStore } from "../agents/agentStore";
import { workspaceStore } from "../agents/workspaceStore";
import { PR_CLIENT_STUB } from "../agents/stubAgentClient";
import type { AgentClient } from "../agents/agentClient";
import type { GithubOpenPr, PrImportPreflight, PrWorkspace } from "../state/types";

function githubPr(number: number, overrides: Partial<GithubOpenPr> = {}): GithubOpenPr {
  return {
    number,
    title: "Add refunds",
    head_ref: "feature/refunds",
    author: "octocat",
    ...overrides,
  };
}

function pr(number: number, overrides: Partial<PrWorkspace> = {}): PrWorkspace {
  return {
    id: `pr-${number}`,
    number,
    title: "Add refunds",
    url: `https://github.com/acme/app/pull/${number}`,
    author: "octocat",
    state: "OPEN",
    head_ref: "feature/refunds",
    head_sha: "abc1234",
    head_repo: "octocat/app",
    is_fork: false,
    base_ref: "main",
    worktree: `/repo/.codechroma/worktrees/pr-${number}`,
    imported_at: "2026-07-29T12:00:00Z",
    fetched_at: "2026-07-29T12:00:00Z",
    changed_files: 3,
    additions: 4,
    deletions: 1,
    worktree_lost: false,
    ...overrides,
  };
}

const READY: PrImportPreflight = { ready: true, reason: null };

function client(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    ...PR_CLIENT_STUB,
    prImportPreflight: async () => READY,
    listPrs: async () => ({ prs: [], max_prs: 3, active_workspace: "main" }),
    listGithubPrs: async () => [githubPr(7), githubPr(9, { title: "Add coupons" })],
    openPr: async (ref: string) => pr(Number(ref.replace(/\D/g, "")) || 7),
    refreshPr: async (number: number) => ({ ...pr(number), updated: false }),
    closePr: async () => {},
    activateWorkspace: async (id: string) => ({
      id,
      state: "ready" as const,
      progress: "",
      error: null,
      read_only: id.startsWith("pr-"),
    }),
    workspaceStatus: async (id: string) => ({
      id,
      state: "ready" as const,
      progress: "",
      error: null,
    }),
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
    gitPreflight: async () => ({ state: "ready" as const, root: "/repo" }),
    gitInit: async () => ({ state: "ready", created_repo: true, created_gitignore: true }),
    getBranch: async () => ({ current: "main", branches: ["main"] }),
    switchBranch: async (branch) => ({ current: branch, branches: ["main"] }),
    updateBranch: async () => ({ current: "main", branches: ["main"] }),
    ...overrides,
  };
}

function renderDialog(agentClient: AgentClient = client(), onDismiss = () => {}) {
  return render(
    <AgentClientProvider client={agentClient}>
      <PrDialog onDismiss={onDismiss} />
    </AgentClientProvider>,
  );
}

function selectPr(number: number) {
  fireEvent.change(screen.getByTestId("pr-dialog-select"), { target: { value: String(number) } });
}

/** The store is module-global, so a list pushed after render must be wrapped for React to see it. */
function publish(prs: PrWorkspace[]) {
  act(() => {
    prStore.setList(prs);
  });
}

afterEach(() => {
  prStore.reset();
  workspaceStore.reset();
  agentStore.reset();
  vi.restoreAllMocks();
  delete (window as { codechromaDesktop?: unknown }).codechromaDesktop;
});

describe("PrDialog", () => {
  it("says it is checking until the preflight answers", () => {
    renderDialog(client({ prImportPreflight: () => new Promise(() => {}) }));

    expect(screen.getByTestId("pr-dialog-open")).toHaveTextContent("Checking…");
    expect(screen.getByTestId("pr-dialog-open")).toBeDisabled();
  });

  it("renders a blocker as the button's own label, not as an error after a click", async () => {
    renderDialog(
      client({
        prImportPreflight: async () => ({
          ready: false,
          reason: "gh-missing",
          text: "GitHub CLI required",
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("pr-dialog-open")).toHaveTextContent("GitHub CLI required"),
    );
    expect(screen.getByTestId("pr-dialog-open")).toBeDisabled();
    expect(screen.getByTestId("pr-dialog-select")).toBeDisabled();
  });

  it("keeps the primary disabled while nothing is selected", async () => {
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("pr-dialog-open")).toHaveTextContent("Open on canvas"),
    );
    expect(screen.getByTestId("pr-dialog-open")).toBeDisabled();
  });

  it("disables the picker once GitHub's open PRs are known to be none", async () => {
    renderDialog(client({ listGithubPrs: async () => [] }));

    await waitFor(() =>
      expect(screen.getByTestId("pr-dialog-select")).toHaveTextContent("No open pull requests"),
    );
    expect(screen.getByTestId("pr-dialog-select")).toBeDisabled();
  });

  it("opens a picked pull request and makes it the active workspace", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("pr-dialog-select")).not.toBeDisabled());

    selectPr(7);
    fireEvent.click(screen.getByTestId("pr-dialog-open"));

    await waitFor(() => expect(agentStore.getActiveWorkspace()).toBe("pr-7"));
    expect(prStore.has("pr-7")).toBe(true);
    expect(workspaceStore.getIsReadOnly("pr-7")).toBe(true);
  });

  it("surfaces the bridge's own rejection as the dialog's error", async () => {
    renderDialog(
      client({
        openPr: async () => {
          throw new Error("That pull request is in another repository");
        },
      }),
    );
    await waitFor(() => expect(screen.getByTestId("pr-dialog-select")).not.toBeDisabled());

    selectPr(9);
    fireEvent.click(screen.getByTestId("pr-dialog-open"));

    await waitFor(() =>
      expect(screen.getByTestId("pr-dialog-error")).toHaveTextContent("another repository"),
    );
  });

  it("lists an already-open review with its head and base", async () => {
    renderDialog(client({ listPrs: async () => ({ prs: [], max_prs: 3, active_workspace: "main" }) }));
    publish([pr(7)]);

    await waitFor(() => expect(screen.getByTestId("pr-dialog-row")).toBeInTheDocument());
    expect(screen.getByTestId("pr-dialog-row")).toHaveTextContent("#7 · Add refunds");
    expect(screen.getByTestId("pr-dialog-row")).toHaveTextContent("feature/refunds → main");
  });

  it("marks a fork so it is obvious whose branch this is", async () => {
    renderDialog();
    publish([pr(7, { is_fork: true, head_repo: "octocat/app" })]);

    await waitFor(() =>
      expect(screen.getByTestId("pr-dialog-row")).toHaveTextContent("fork octocat/app"),
    );
  });

  it("says on canvas instead of offering to activate the active one", async () => {
    renderDialog();
    publish([pr(7)]);
    act(() => agentStore.setActiveWorkspace("pr-7"));

    await waitFor(() => expect(screen.getByText("on canvas")).toBeInTheDocument());
    expect(screen.queryByTestId("pr-dialog-activate")).not.toBeInTheDocument();
  });

  it("flags a review whose copy was deleted from disk", async () => {
    renderDialog();
    publish([pr(7, { worktree_lost: true })]);

    await waitFor(() => expect(screen.getByTestId("pr-dialog-row-lost")).toBeInTheDocument());
  });

  it("closing a review removes it and returns the canvas to main", async () => {
    const closePr = vi.fn(async () => {});
    renderDialog(client({ closePr }));
    publish([pr(7)]);
    act(() => agentStore.setActiveWorkspace("pr-7"));
    await waitFor(() => expect(screen.getByTestId("pr-dialog-close-pr")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pr-dialog-close-pr"));

    await waitFor(() => expect(agentStore.getActiveWorkspace()).toBe("main"));
    expect(closePr).toHaveBeenCalledWith(7);
    expect(prStore.has("pr-7")).toBe(false);
  });

  it("refreshing asks the bridge to re-fetch that review", async () => {
    const refreshPr = vi.fn(async (number: number) => ({ ...pr(number), updated: false }));
    renderDialog(client({ refreshPr }));
    publish([pr(7)]);
    await waitFor(() => expect(screen.getByTestId("pr-dialog-refresh")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pr-dialog-refresh"));

    await waitFor(() => expect(refreshPr).toHaveBeenCalledWith(7));
  });

  it("says the head moved, and to what, so a refresh that pulled commits is visible", async () => {
    const refreshPr = vi.fn(async (number: number) => ({
      ...pr(number),
      head_sha: "9f3c1d20aa",
      updated: true,
    }));
    renderDialog(client({ refreshPr }));
    publish([pr(7)]);
    await waitFor(() => expect(screen.getByTestId("pr-dialog-refresh")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pr-dialog-refresh"));

    await waitFor(() =>
      expect(screen.getByTestId("pr-dialog-row-notice")).toHaveTextContent("Updated to 9f3c1d2"),
    );
  });

  it("says a refresh that found nothing new was still a refresh, not a dead button", async () => {
    const refreshPr = vi.fn(async (number: number) => ({ ...pr(number), updated: false }));
    renderDialog(client({ refreshPr }));
    publish([pr(7)]);
    await waitFor(() => expect(screen.getByTestId("pr-dialog-refresh")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pr-dialog-refresh"));

    await waitFor(() =>
      expect(screen.getByTestId("pr-dialog-row-notice")).toHaveTextContent("Already up to date"),
    );
  });

  it("announces the refresh outcome, since nothing else about the row visibly changes", async () => {
    const refreshPr = vi.fn(async (number: number) => ({ ...pr(number), updated: false }));
    renderDialog(client({ refreshPr }));
    publish([pr(7)]);
    await waitFor(() => expect(screen.getByTestId("pr-dialog-refresh")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pr-dialog-refresh"));

    // role="status" is an implicit aria-live="polite": the whole point of the line is that a
    // refresh otherwise changes nothing observable, which is doubly true without sight of the row.
    await waitFor(() =>
      expect(screen.getByTestId("pr-dialog-row-notice")).toHaveAttribute("role", "status"),
    );
  });

  it("shows the outcome only on the row that was refreshed", async () => {
    const refreshPr = vi.fn(async (number: number) => ({ ...pr(number), updated: false }));
    renderDialog(client({ refreshPr }));
    publish([pr(7), pr(9)]);
    await waitFor(() => expect(screen.getAllByTestId("pr-dialog-refresh")).toHaveLength(2));

    fireEvent.click(screen.getAllByTestId("pr-dialog-refresh")[0]);

    await waitFor(() => expect(screen.getAllByTestId("pr-dialog-row-notice")).toHaveLength(1));
  });

  it("hides Open in New Window outside the desktop app", async () => {
    renderDialog();
    publish([pr(7)]);

    await waitFor(() => expect(screen.getByTestId("pr-dialog-row")).toBeInTheDocument());
    expect(screen.queryByTestId("pr-dialog-open-window")).not.toBeInTheDocument();
  });

  it("opens a satellite window for the review inside the desktop app", async () => {
    const openWorkspaceWindow = vi.fn(async () => {});
    window.codechromaDesktop = {
      openWorkspaceWindow,
      closeWorkspaceWindow: vi.fn(async () => {}),
      focusThisTab: vi.fn(async () => {}),
    };
    renderDialog();
    publish([pr(7)]);
    await waitFor(() => expect(screen.getByTestId("pr-dialog-open-window")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pr-dialog-open-window"));

    expect(openWorkspaceWindow).toHaveBeenCalledWith("pr-7");
  });

  it("closes a review's satellite window when the review itself is closed", async () => {
    const closeWorkspaceWindow = vi.fn(async () => {});
    window.codechromaDesktop = {
      openWorkspaceWindow: vi.fn(async () => {}),
      closeWorkspaceWindow,
      focusThisTab: vi.fn(async () => {}),
    };
    const closePr = vi.fn(async () => {});
    renderDialog(client({ closePr }));
    publish([pr(7)]);
    await waitFor(() => expect(screen.getByTestId("pr-dialog-close-pr")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pr-dialog-close-pr"));

    await waitFor(() => expect(closeWorkspaceWindow).toHaveBeenCalledWith("pr-7"));
  });

  it("is portalled out of where it is rendered, so no window can paint over it", () => {
    const { container } = renderDialog();

    expect(container.querySelector('[data-testid="pr-dialog"]')).toBeNull();
    expect(screen.getByTestId("pr-dialog")).toBeInTheDocument();
  });

  it("Escape dismisses it", async () => {
    const onDismiss = vi.fn();
    renderDialog(client(), onDismiss);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalled();
  });
});
