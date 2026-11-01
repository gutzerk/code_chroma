import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentClient } from "../../../agents/agentClient";
import { AgentClientProvider } from "../../../agents/AgentClientContext";
import { agentStore } from "../../../agents/agentStore";
import { PR_CLIENT_STUB } from "../../../agents/stubAgentClient";
import type { EngineClient } from "../../../engine-client/EngineClient";
import { EngineClientProvider } from "../../../engine-client/EngineClientContext";
import { IMPACT_CHANGES_STUB } from "../../../engine-client/stubEngineClient";
import type { AgentRecord, BuiltinDiagramKind } from "../../../state/types";
import { DrawDialog } from "./DrawDialog";
import { drawDialogStore } from "./drawDialogStore";

const KINDS: BuiltinDiagramKind[] = [
  { id: "any", name: "Let the agent pick", purpose: "Pick for me" },
  { id: "sequence", name: "Sequence", purpose: "Calls in order" },
  { id: "custom", name: "Custom type", purpose: "Your own" },
];

function agent(): AgentRecord {
  return {
    id: "draw-sequence",
    title: "Draw · Sequence",
    kind: "agent",
    branch: "main",
    worktree: "/repo",
    created_at: "2026-01-01T00:00:00Z",
    session_id: null,
    pr_url: null,
    pid: null,
    window: { x: 0, y: 0, width: 720, height: 480, minimized: false, z: 1 },
    status: "running",
    exit_code: null,
    worktree_lost: false,
  };
}

function renderDialog(overrides: Partial<AgentClient> = {}, saved: EngineClient["listDiagramTypes"] = async () => []) {
  const create = vi.fn(async () => agent());
  const client = {
    ...PR_CLIENT_STUB,
    diagramKinds: async () => KINDS,
    gitPreflight: async () => ({ state: "ready" as const, root: "/repo" }),
    create,
    start: async () => agent(),
    saveWindow: async () => {},
    ...overrides,
  } as unknown as AgentClient;
  render(
    <EngineClientProvider repoId="main" client={{ ...IMPACT_CHANGES_STUB, listDiagramTypes: saved } as unknown as EngineClient}>
      <AgentClientProvider client={client}>
        <DrawDialog />
      </AgentClientProvider>
    </EngineClientProvider>,
  );
  return create;
}

afterEach(() => {
  cleanup();
  agentStore.reset();
  drawDialogStore.reset();
});

describe("DrawDialog", () => {
  it("renders nothing until opened, then lists the bridge's kinds", async () => {
    renderDialog();
    expect(screen.queryByTestId("draw-dialog")).toBeNull();

    act(() => drawDialogStore.open());

    expect(await screen.findByTestId("draw-card-sequence")).toBeInTheDocument();
    expect(screen.getByTestId("draw-card-any")).toHaveAttribute("aria-checked", "true");
  });

  it("draws with the picked type and the typed request on Enter, then closes", async () => {
    const create = renderDialog();
    act(() => drawDialogStore.open());
    fireEvent.click(await screen.findByTestId("draw-card-sequence"));

    const prompt = screen.getByTestId("draw-dialog-prompt");
    fireEvent.change(prompt, { target: { value: "a save reaches the db, current change only" } });
    fireEvent.keyDown(prompt, { key: "Enter" });

    await waitFor(() => expect(create).toHaveBeenCalled());
    const calls = create.mock.calls as unknown as unknown[][];
    expect(calls[0][5]).toEqual({
      type: "sequence",
      request: "a save reaches the db, current change only",
      title: "Draw · Sequence",
    });
    await waitFor(() => expect(drawDialogStore.getState().open).toBe(false));
    expect(drawDialogStore.getState().prompt).toBe("");
  });

  it("keeps the dialog open and shows the error when the launch fails", async () => {
    renderDialog({ create: async () => { throw new Error("boom"); } });
    act(() => drawDialogStore.open());
    await screen.findByTestId("draw-card-sequence");

    fireEvent.click(screen.getByTestId("draw-dialog-submit"));

    expect(await screen.findByTestId("draw-dialog-error")).toHaveTextContent("boom");
    expect(drawDialogStore.getState().open).toBe(true);
  });

  it("closes on Escape and keeps the draft for next time", async () => {
    renderDialog();
    act(() => drawDialogStore.open());
    await screen.findByTestId("draw-card-sequence");
    fireEvent.change(screen.getByTestId("draw-dialog-prompt"), { target: { value: "half a thought" } });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(drawDialogStore.getState().open).toBe(false);
    expect(drawDialogStore.getState().prompt).toBe("half a thought");
  });

  it("moves the selection with the arrow keys", async () => {
    renderDialog();
    act(() => drawDialogStore.open());
    const first = await screen.findByTestId("draw-card-any");

    fireEvent.keyDown(first, { key: "ArrowRight" });

    expect(screen.getByTestId("draw-card-sequence")).toHaveAttribute("aria-checked", "true");
  });

  it("disables drawing at agent capacity, with the limit as the reason", async () => {
    renderDialog();
    act(() => {
      for (let i = 0; i < 5; i++) agentStore.upsert({ ...agent(), id: `a${i}` });
      drawDialogStore.open();
    });
    await screen.findByTestId("draw-card-sequence");

    expect(screen.getByTestId("draw-dialog-submit")).toBeDisabled();
    expect(screen.getByTestId("draw-dialog-submit")).toHaveAttribute("title", expect.stringContaining("limit"));
  });

  it("gives a saved type with a schematic its own card, named in the request", async () => {
    const create = renderDialog({}, async () => [
      { id: "data-flow", title: "Data flow", description: "Where data moves", style: "boxes-arrows", schematic: "dataflow" },
    ]);
    act(() => drawDialogStore.open());
    fireEvent.click(await screen.findByTestId("draw-card-custom:data-flow"));

    fireEvent.click(screen.getByTestId("draw-dialog-submit"));

    await waitFor(() => expect(create).toHaveBeenCalled());
    const hint = (create.mock.calls as unknown as unknown[][])[0][5] as { type: string; request: string };
    expect(hint.type).toBe("custom");
    expect(hint.request).toContain('"data-flow"');
  });
});
