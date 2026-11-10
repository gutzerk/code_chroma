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
import { tutorialSimStore } from "../../../tutorial/tutorialSim";
import { tutorialStore } from "../../../tutorial/tutorialStore";
import { DrawDialog } from "./DrawDialog";
import { drawDialogStore } from "./drawDialogStore";

const KINDS: BuiltinDiagramKind[] = [
  { id: "any", name: "Let the agent pick", purpose: "Pick for me" },
  { id: "sequence", name: "Sequence", purpose: "Calls in order" },
  { id: "patterns", name: "Design patterns", purpose: "Patterns in the code" },
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
    status: "idle",
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

/** Types the "What should it show?" request the dialog needs before it draws. */
function typeRequest(text: string) {
  fireEvent.change(screen.getByTestId("draw-dialog-prompt"), { target: { value: text } });
}

afterEach(() => {
  cleanup();
  agentStore.reset();
  drawDialogStore.reset();
  tutorialStore.reset();
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

  it("disables Draw with agent until the request says what to draw", async () => {
    renderDialog();
    act(() => drawDialogStore.open());
    await screen.findByTestId("draw-card-any");
    const submit = screen.getByTestId("draw-dialog-submit");
    const disabledWhenEmpty = submit.hasAttribute("disabled");
    typeRequest("   ");
    const disabledWhenBlank = submit.hasAttribute("disabled");

    typeRequest("the auth flow");

    expect(disabledWhenEmpty).toBe(true);
    expect(disabledWhenBlank).toBe(true);
    expect(submit).not.toBeDisabled();
  });

  it("does not launch an agent on Enter with an empty request", async () => {
    const create = renderDialog();
    act(() => drawDialogStore.open());
    await screen.findByTestId("draw-card-any");

    fireEvent.keyDown(screen.getByTestId("draw-dialog-prompt"), { key: "Enter" });
    fireEvent.keyDown(screen.getByTestId("draw-card-any"), { key: "Enter" });

    expect(create).not.toHaveBeenCalled();
    expect(drawDialogStore.getState().open).toBe(true);
    expect(screen.getByTestId("draw-dialog-prompt")).toHaveFocus();
  });

  it("starts the scripted tutorial agent without creating a real agent", async () => {
    const create = renderDialog();
    act(() => {
      tutorialStore.start();
      drawDialogStore.open();
    });
    await screen.findByTestId("draw-card-any");

    fireEvent.click(screen.getByTestId("draw-dialog-submit"));

    expect(create).not.toHaveBeenCalled();
    expect(drawDialogStore.getState().open).toBe(false);
    expect(tutorialSimStore.getSnapshot().agent).toBe("open");
  });

  it("advances the tutorial when Design patterns is picked with the keyboard", async () => {
    renderDialog();
    act(() => {
      tutorialStore.start();
      while (tutorialStore.currentStepId() !== "choose-diagram") tutorialStore.next();
      drawDialogStore.open();
    });
    const anyCard = await screen.findByTestId("draw-card-any");

    fireEvent.keyDown(anyCard, { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByTestId("draw-card-sequence"), { key: "ArrowRight" });

    expect(drawDialogStore.getState().cardId).toBe("patterns");
    expect(tutorialStore.currentStepId()).toBe("start-draw");
  });

  it("keeps Design patterns selected once the tutorial asks to draw", async () => {
    renderDialog();
    act(() => {
      tutorialStore.start();
      while (tutorialStore.currentStepId() !== "choose-diagram") tutorialStore.next();
      drawDialogStore.open();
    });
    fireEvent.click(await screen.findByTestId("draw-card-patterns"));

    fireEvent.keyDown(screen.getByTestId("draw-card-patterns"), { key: "ArrowLeft" });
    fireEvent.click(screen.getByTestId("draw-card-sequence"));

    expect(tutorialStore.currentStepId()).toBe("start-draw");
    expect(drawDialogStore.getState().cardId).toBe("patterns");
  });

  it("does not let Escape or prompt Enter skip the guided diagram selection", async () => {
    renderDialog();
    act(() => {
      tutorialStore.start();
      drawDialogStore.open();
    });
    await screen.findByTestId("draw-card-any");

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(screen.getByTestId("draw-dialog-prompt"), { key: "Enter" });

    expect(drawDialogStore.getState().open).toBe(true);
    expect(tutorialSimStore.getSnapshot().agent).toBe("closed");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("keeps the dialog open and shows the error when the launch fails", async () => {
    renderDialog({ create: async () => { throw new Error("boom"); } });
    act(() => drawDialogStore.open());
    await screen.findByTestId("draw-card-sequence");
    typeRequest("the checkout flow");

    fireEvent.click(screen.getByTestId("draw-dialog-submit"));

    expect(await screen.findByTestId("draw-dialog-error")).toHaveTextContent("boom");
    expect(drawDialogStore.getState().open).toBe(true);
  });

  it("closes on Escape and keeps the draft for next time", async () => {
    renderDialog();
    act(() => drawDialogStore.open());
    await screen.findByTestId("draw-card-sequence");
    typeRequest("half a thought");

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
    typeRequest("orders only");

    fireEvent.click(screen.getByTestId("draw-dialog-submit"));

    await waitFor(() => expect(create).toHaveBeenCalled());
    const hint = (create.mock.calls as unknown as unknown[][])[0][5] as { type: string; request: string };
    expect(hint.type).toBe("custom");
    expect(hint.request).toBe('Use the saved diagram type "data-flow". orders only');
  });
});
