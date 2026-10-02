import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NoteElement } from "./NoteElement";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { canvasDocStore } from "./canvasDocStore";
import { dragOffsetStore } from "./dragOffsetStore";
import { selectionStore } from "../../state/selectionStore";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { CanvasElement } from "../../state/types";

function note(overrides: Partial<CanvasElement> & { id: string }): CanvasElement {
  return {
    render: "note",
    layer: "chat",
    label: "remember this",
    description: "",
    node_id: null,
    position: { x: 100, y: 100 },
    size: null,
    group_id: null,
    meta: {},
    created_by: "ai",
    ...overrides,
  };
}

const client = { patchCanvas: vi.fn() } as unknown as EngineClient;

afterEach(() => {
  canvasDocStore.reset();
  selectionStore.reset();
  dragOffsetStore.reset();
});

function renderNote(el: CanvasElement) {
  return render(
    <EngineClientProvider repoId="default" client={client}>
      <NoteElement element={el} />
    </EngineClientProvider>,
  );
}

describe("NoteElement — keyboard access", () => {
  it("enters edit mode on Enter, not just on click", () => {
    renderNote(note({ id: "n1" }));

    fireEvent.keyDown(screen.getByTestId("canvas-note-box-text"), { key: "Enter" });

    expect(screen.getByTestId("canvas-note-box-input")).toBeInTheDocument();
  });

  it("enters edit mode on Space too", () => {
    renderNote(note({ id: "n1" }));

    fireEvent.keyDown(screen.getByTestId("canvas-note-box-text"), { key: " " });

    expect(screen.getByTestId("canvas-note-box-input")).toBeInTheDocument();
  });

  it("ignores an unrelated key", () => {
    renderNote(note({ id: "n1" }));

    fireEvent.keyDown(screen.getByTestId("canvas-note-box-text"), { key: "Tab" });

    expect(screen.queryByTestId("canvas-note-box-input")).not.toBeInTheDocument();
  });
});

describe("NoteElement — selection", () => {
  it("clicking a note clears any active multi-selection", () => {
    selectionStore.replace(["some-other-box"]);
    renderNote(note({ id: "n1" }));

    fireEvent.click(screen.getByTestId("canvas-note-box-text"));

    expect(selectionStore.getSelectedIds()).toEqual([]);
  });

  it("does not clear the selection on a shift-click (an in-progress marquee/multi-select gesture)", () => {
    selectionStore.replace(["some-other-box"]);
    renderNote(note({ id: "n1" }));

    fireEvent.click(screen.getByTestId("canvas-note-box-text"), { shiftKey: true });

    expect(selectionStore.getSelectedIds()).toEqual(["some-other-box"]);
  });
});

describe("NoteElement — drag abort (useCanvasElementDrag)", () => {
  it("clears its own live offset if it unmounts mid-drag, instead of rendering permanently offset", async () => {
    const { unmount } = renderNote(note({ id: "n1" }));
    const handle = screen.getByTestId("canvas-note-box");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 20 });
    // onPreview is rAF-throttled (useDragOffset.ts) -- give the pending frame a chance to flush
    // before asserting the preview actually landed in the store.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(dragOffsetStore.getAll()).toEqual({ n1: { x: 30, y: 20 } });

    // The note gets deleted by another window/agent mid-gesture -- no pointerup ever reaches this
    // drag, so onEnd never runs.
    unmount();

    expect(dragOffsetStore.getAll()).toEqual({});
  });
});
