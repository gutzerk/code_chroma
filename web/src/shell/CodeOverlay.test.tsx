import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CodeOverlay, openCodeFor } from "./CodeOverlay";
import { shellStore } from "./shellStore";
import { openFilesStore } from "../canvas/openFilesStore";
import type { HierarchyNodeRef } from "../state/types";

const node = (id: string): HierarchyNodeRef =>
  ({
    node_id: id,
    name: `${id}.py`,
    level: "code",
    parent_id: null,
    has_children: false,
    child_count: 0,
    source: `print("${id}")`,
    language: "python",
  }) as unknown as HierarchyNodeRef;

beforeEach(() => {
  shellStore.reset();
  openFilesStore.reset();
});
afterEach(cleanup);

describe("CodeOverlay", () => {
  it("renders nothing while closed", () => {
    render(<CodeOverlay />);

    expect(screen.queryByTestId("code-overlay")).toBeNull();
  });

  it("opens via openCodeFor and shows the file tab and source", () => {
    render(<CodeOverlay />);

    act(() => openCodeFor(node("a")));

    expect(screen.getByTestId("code-overlay")).toBeInTheDocument();
    expect(screen.getAllByTestId("code-overlay-tab")).toHaveLength(1);
    expect(screen.getByTestId("block-code-view-source")).toHaveTextContent('print("a")');
  });

  it("switches the active tab on click", () => {
    render(<CodeOverlay />);
    act(() => {
      openCodeFor(node("a"));
      openCodeFor(node("b"));
    });

    fireEvent.click(screen.getByText("a.py"));

    expect(screen.getByTestId("block-code-view-source")).toHaveTextContent('print("a")');
  });

  it("closes on the close button", () => {
    render(<CodeOverlay />);
    act(() => openCodeFor(node("a")));

    fireEvent.click(screen.getByLabelText("Close code"));

    expect(screen.queryByTestId("code-overlay")).toBeNull();
  });

  it("closes on Escape", () => {
    render(<CodeOverlay />);
    act(() => openCodeFor(node("a")));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("code-overlay")).toBeNull();
  });

  it("leaves agents mode untouched on close", () => {
    render(<CodeOverlay />);
    act(() => openCodeFor(node("a")));
    const mode = shellStore.getState().agents.mode;

    fireEvent.click(screen.getByLabelText("Close code"));

    expect(shellStore.getState().agents.mode).toBe(mode);
  });
});
