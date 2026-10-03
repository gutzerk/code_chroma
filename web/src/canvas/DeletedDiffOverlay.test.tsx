import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeletedDiffOverlay } from "./DeletedDiffOverlay";
import { diffOverlayStore } from "../state/diffOverlayStore";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { MockBridgeEngineClient } from "../engine-client/mockBridge";
import { agentStore } from "../agents/agentStore";
import { workspaceStore } from "../agents/workspaceStore";

afterEach(() => {
  diffOverlayStore.reset();
  workspaceStore.reset();
  agentStore.reset();
});

function renderOverlay() {
  return render(
    <EngineClientProvider repoId="default" client={new MockBridgeEngineClient()}>
      <DeletedDiffOverlay />
    </EngineClientProvider>,
  );
}

describe("DeletedDiffOverlay", () => {
  it("renders a blurred panel per deleted diff and nothing for non-deleted", () => {
    diffOverlayStore.write([
      { node_id: "f::gone", name: "gone", status: "deleted", original_source: "def gone(): ...", proposed_source: "" },
      { node_id: "f::kept", name: "kept", status: "modified", original_source: "a", proposed_source: "b" },
    ]);

    renderOverlay();

    const panels = screen.getAllByTestId("diff-view");
    expect(panels).toHaveLength(1);
    expect(panels[0].className).toContain("diff-view--deleted");
    expect(screen.getByText("gone", { selector: ".block-code-view-name" })).toBeInTheDocument();
    expect(screen.queryByText("kept", { selector: ".block-code-view-name" })).not.toBeInTheDocument();
  });

  it("renders nothing when there are no deletions", () => {
    diffOverlayStore.write([
      { node_id: "f::kept", name: "kept", status: "modified", original_source: "a", proposed_source: "b" },
    ]);

    const { container } = renderOverlay();

    expect(container.firstChild).toBeNull();
  });

  it("commits a deleted diff via acceptDiff when its panel's Accept button is clicked", async () => {
    diffOverlayStore.write([
      { node_id: "f::gone", name: "gone", status: "deleted", original_source: "def gone(): ...", proposed_source: "" },
    ]);
    const acceptSpy = vi.spyOn(MockBridgeEngineClient.prototype, "acceptDiff");

    renderOverlay();
    fireEvent.click(screen.getByTestId("diff-accept-button"));

    expect(acceptSpy).toHaveBeenCalledWith("f::gone");
    await waitFor(() => expect(screen.queryByTestId("diff-view")).not.toBeInTheDocument());

    acceptSpy.mockRestore();
  });

  it("offers no Accept in a read-only workspace", () => {
    diffOverlayStore.write([
      { node_id: "f::gone", name: "gone", status: "deleted", original_source: "def gone(): ...", proposed_source: "" },
    ]);
    agentStore.setActiveWorkspace("pr-7");
    workspaceStore.setStatus({
      id: "pr-7", state: "ready", progress: "", error: null, read_only: true,
    });

    renderOverlay();

    expect(screen.getByTestId("diff-view")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-accept-button")).not.toBeInTheDocument();
  });
});
