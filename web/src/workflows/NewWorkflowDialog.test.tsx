import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentClientProvider } from "../agents/AgentClientContext";
import { MockAgentClient } from "../agents/mockAgentClient";
import { agentStore } from "../agents/agentStore";
import { worktreeStore } from "../agents/worktreeStore";
import { NewWorkflowDialog } from "./NewWorkflowDialog";
import { workflowStore } from "./workflowStore";

function renderDialog(client: MockAgentClient | null, onClose = vi.fn()) {
  const dialog = <NewWorkflowDialog onClose={onClose} />;
  render(client ? <AgentClientProvider client={client}>{dialog}</AgentClientProvider> : dialog);
  return onClose;
}

beforeEach(() => {
  workflowStore.reset();
  agentStore.reset();
  worktreeStore.reset();
  worktreeStore.setActive("br_1");
});
afterEach(cleanup);

describe("NewWorkflowDialog", () => {
  it("opens the editor for By hand", () => {
    renderDialog(new MockAgentClient());

    fireEvent.click(screen.getByTestId("create-by-hand"));

    expect(workflowStore.getDialog()).toEqual({ kind: "editor" });
  });

  it("asks for a description before an agent can start", () => {
    renderDialog(new MockAgentClient());

    fireEvent.click(screen.getByTestId("create-with-agent"));
    const start = screen.getByTestId("start-workflow-agent");
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "What should the workflow do?" }), { target: { value: "plan then review" } });

    expect(start).toBeEnabled();
  });

  it("starts an agent with the description and closes", async () => {
    const client = new MockAgentClient();
    await client.createWorktree();
    const create = vi.spyOn(client, "create");
    const onClose = renderDialog(client);

    fireEvent.click(screen.getByTestId("create-with-agent"));
    fireEvent.change(screen.getByRole("textbox", { name: "What should the workflow do?" }), { target: { value: "  plan then review " } });
    fireEvent.click(screen.getByTestId("start-workflow-agent"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(create).toHaveBeenCalledWith("New workflow", "agent", undefined, expect.any(String), "task", undefined, "br_1", "plan then review");
    expect(agentStore.getAgents()[0]?.workflow_request).toBe("plan then review");
  });

  it("keeps the dialog and the description open when git is not ready", async () => {
    const client = new MockAgentClient();
    client.setPreflight({ state: "no-git", root: "/mock/repo" });
    const onClose = renderDialog(client);

    fireEvent.click(screen.getByTestId("create-with-agent"));
    fireEvent.change(screen.getByRole("textbox", { name: "What should the workflow do?" }), { target: { value: "plan then review" } });
    fireEvent.click(screen.getByTestId("start-workflow-agent"));
    await waitFor(() => expect(agentStore.getGitPreflight()?.state).toBe("no-git"));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "What should the workflow do?" })).toHaveValue("plan then review");
  });

  it("disables the agent option until a worktree tab is open", () => {
    worktreeStore.reset();
    renderDialog(new MockAgentClient());

    expect(screen.getByTestId("create-with-agent")).toBeDisabled();
    expect(screen.getByText("Open a worktree tab first: the agent works in it")).toBeInTheDocument();
  });

  it("disables the agent option without an agent client", () => {
    renderDialog(null);

    expect(screen.getByTestId("create-with-agent")).toBeDisabled();
    expect(screen.getByText("Agents are not available here")).toBeInTheDocument();
  });
});
