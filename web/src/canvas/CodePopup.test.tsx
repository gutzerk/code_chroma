import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CodePopup } from "./CodePopup";
import { diffOverlayStore } from "../state/diffOverlayStore";
import type { HierarchyNodeRef } from "../state/types";

const NODE: HierarchyNodeRef = {
  node_id: "function::example",
  name: "example",
  level: "function",
  parent_id: "file::example.py",
  has_children: false,
  child_count: 0,
  params: "(a: int) -> int",
  source: "def example(a: int) -> int:\n    return a",
  language: "python",
};

afterEach(() => {
  diffOverlayStore.reset();
});

describe("CodePopup", () => {
  it("renders a diff instead of plain source once a diff exists for the node", () => {
    diffOverlayStore.setDiffs([
      {
        node_id: NODE.node_id,
        original_source: NODE.source ?? "",
        proposed_source: "def example(a: int) -> int:\n    return a + 1",
      },
    ]);

    render(<CodePopup node={NODE} onClose={() => {}} />);

    expect(screen.getByTestId("diff-view")).toBeInTheDocument();
    expect(screen.queryByTestId("block-code-view-source")).not.toBeInTheDocument();
  });

  it("renders the node's name and params in the title bar, plus the source", () => {
    render(<CodePopup node={NODE} onClose={() => {}} />);
    expect(screen.getByText("example", { selector: ".code-popup-title" })).toBeInTheDocument();
    expect(
      screen.getByText("(a: int) -> int", { selector: ".code-popup-title-params" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("block-code-view-source")).toHaveTextContent(
      "def example(a: int) -> int: return a",
    );
  });

  it("syntax-highlights the source for known languages", () => {
    render(<CodePopup node={NODE} onClose={() => {}} />);
    const source = screen.getByTestId("block-code-view-source");
    expect(source.querySelector(".token-keyword")).toHaveTextContent("def");
  });

  it("renders plain text for nodes without a recognized language", () => {
    const plainNode: HierarchyNodeRef = { ...NODE, language: undefined };
    render(<CodePopup node={plainNode} onClose={() => {}} />);
    const source = screen.getByTestId("block-code-view-source");
    expect(source.querySelector(".token-keyword")).toBeNull();
    expect(source).toHaveTextContent("def example(a: int) -> int: return a");
  });

  it("closes when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<CodePopup node={NODE} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close example code popup" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked but not when the panel itself is clicked", () => {
    const onClose = vi.fn();
    render(<CodePopup node={NODE} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("code-popup"));

    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("code-popup-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<CodePopup node={NODE} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("dragging the popup by its title bar", () => {
    function readTransform(panel: HTMLElement) {
      const match = panel.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
      if (!match) throw new Error(`unexpected transform: ${panel.style.transform}`);
      return { x: Number(match[1]), y: Number(match[2]) };
    }

    function drag(el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
      fireEvent.pointerMove(el, { pointerId: 1, clientX: to.x, clientY: to.y });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: to.x, clientY: to.y });
    }

    it("moves the panel by the drag delta when dragging the title bar", () => {
      render(<CodePopup node={NODE} onClose={() => {}} />);
      const panel = screen.getByTestId("code-popup");
      const titlebar = screen.getByTestId("code-popup-titlebar");
      expect(readTransform(panel)).toEqual({ x: 0, y: 0 });

      drag(titlebar, { x: 100, y: 100 }, { x: 140, y: 130 });

      expect(readTransform(panel)).toEqual({ x: 40, y: 30 });
    });

    it("does not move when the drag never crosses the movement threshold", () => {
      render(<CodePopup node={NODE} onClose={() => {}} />);
      const panel = screen.getByTestId("code-popup");
      const titlebar = screen.getByTestId("code-popup-titlebar");

      drag(titlebar, { x: 100, y: 100 }, { x: 101, y: 101 });

      expect(readTransform(panel)).toEqual({ x: 0, y: 0 });
    });

    it("does not start a drag from the close button, which still closes normally", () => {
      const onClose = vi.fn();
      render(<CodePopup node={NODE} onClose={onClose} />);
      const panel = screen.getByTestId("code-popup");
      const closeButton = screen.getByRole("button", { name: "Close example code popup" });

      drag(closeButton, { x: 100, y: 100 }, { x: 140, y: 130 });

      expect(readTransform(panel)).toEqual({ x: 0, y: 0 });
      fireEvent.click(closeButton);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("leaves the source area alone so its text stays selectable (not a drag handle)", () => {
      render(<CodePopup node={NODE} onClose={() => {}} />);
      const panel = screen.getByTestId("code-popup");
      const source = screen.getByTestId("block-code-view-source");

      drag(source, { x: 100, y: 100 }, { x: 140, y: 130 });

      expect(readTransform(panel)).toEqual({ x: 0, y: 0 });
    });
  });

  describe("resizing the popup via its corner handle", () => {
    function drag(el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
      fireEvent.pointerMove(el, { pointerId: 1, clientX: to.x, clientY: to.y });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: to.x, clientY: to.y });
    }

    it("has no explicit width/height until the handle is dragged", () => {
      render(<CodePopup node={NODE} onClose={() => {}} />);
      const panel = screen.getByTestId("code-popup");
      expect(panel.style.width).toBe("");
      expect(panel.style.height).toBe("");
    });

    it("grows the panel by the drag delta, overriding the default max-width/max-height cap", () => {
      render(<CodePopup node={NODE} onClose={() => {}} />);
      const panel = screen.getByTestId("code-popup");
      const handle = screen.getByTestId("code-popup-resize-handle");

      drag(handle, { x: 100, y: 100 }, { x: 500, y: 400 });

      expect(panel.style.width).toBe("400px");
      expect(panel.style.height).toBe("300px");
      expect(panel.style.maxWidth).toBe("95vw");
      expect(panel.style.maxHeight).toBe("95vh");
    });

    it("never shrinks the panel below the minimum size", () => {
      render(<CodePopup node={NODE} onClose={() => {}} />);
      const panel = screen.getByTestId("code-popup");
      const handle = screen.getByTestId("code-popup-resize-handle");

      drag(handle, { x: 100, y: 100 }, { x: 110, y: 105 });

      expect(panel.style.width).toBe("320px");
      expect(panel.style.height).toBe("200px");
    });
  });
});
