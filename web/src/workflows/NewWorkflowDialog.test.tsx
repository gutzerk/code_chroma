import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentClientProvider } from "../agents/AgentClientContext";
import { MockAgentClient } from "../agents/mockAgentClient";
import { agentStore } from "../agents/agentStore";
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
    const create = vi.spyOn(client, "create");
    const onClose = renderDialog(client);

    fireEvent.click(screen.getByTestId("create-with-agent"));
    fireEvent.change(screen.getByRole("textbox", { name: "What should the workflow do?" }), { target: { value: "  plan then review " } });
    fireEvent.click(screen.getByTestId("start-workflow-agent"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(create).toHaveBeenCalledWith("New workflow", "agent", undefined, expect.any(String), "task", undefined, undefined, "plan then review");
    expect(agentStore.getAgents()[0]?.workflow_request).toBe("plan then review");
  });

  it("disables the agent option without an agent client", () => {
    renderDialog(null);

    expect(screen.getByTestId("create-with-agent")).toBeDisabled();
    expect(screen.getByText("Agents are not available here")).toBeInTheDocument();
  });
});
