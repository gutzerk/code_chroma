import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CodeSidebar } from "./CodeSidebar";
import { openFilesStore } from "./openFilesStore";
import type { HierarchyNodeRef } from "../state/types";

const makeFile = (id: string, name: string): HierarchyNodeRef => ({
  node_id: id,
  name,
  level: "file",
  parent_id: "root",
  has_children: false,
  child_count: 0,
  source: `def ${name}():\n    pass\n`,
});

afterEach(() => {
  openFilesStore.reset();
  vi.restoreAllMocks();
});

describe("CodeSidebar", () => {
  it("renders nothing when no files are open", () => {
    render(<CodeSidebar hidden={false} />);
    expect(screen.queryByTestId("code-sidebar")).toBeNull();
  });

  it("shows a tab per open file in MRU order (most recently viewed first)", () => {
    const a = makeFile("a.py", "a.py");
    const b = makeFile("b.py", "b.py");
    act(() => openFilesStore.open(a));
    act(() => openFilesStore.open(b));
    render(<CodeSidebar hidden={false} />);

    const tabs = screen.getAllByTestId("code-sidebar-tab");
    // b opened last, so it is first (MRU front) and active.
    expect(tabs[0].textContent).toContain("b.py");
    expect(tabs[1].textContent).toContain("a.py");
  });

  it("re-activating a file moves it to the MRU front", () => {
    const a = makeFile("a.py", "a.py");
    const b = makeFile("b.py", "b.py");
    const c = makeFile("c.py", "c.py");
    act(() => openFilesStore.open(a));
    act(() => openFilesStore.open(b));
    act(() => openFilesStore.open(c));
    // Re-open a -> a is now most recent.
    act(() => openFilesStore.open(a));
    render(<CodeSidebar hidden={false} />);

    const tabs = screen.getAllByTestId("code-sidebar-tab");
    expect(tabs[0].textContent).toContain("a.py");
  });

  it("renders an empty file blank, not the no-file message", () => {
    const empty = { ...makeFile("init.py", "__init__.py"), source: "" };
    act(() => openFilesStore.open(empty));
    render(<CodeSidebar hidden={false} />);

    // The empty file is active, so no "No file selected" placeholder appears.
    expect(screen.queryByText("No file selected")).toBeNull();
    // Its blank code view renders (a pre, empty).
    expect(screen.getByTestId("block-code-view")).toBeTruthy();
  });

  it("toggle closes the active file (re-clicking the open row removes its code)", () => {
    const a = makeFile("a.py", "a.py");
    act(() => openFilesStore.open(a));
    expect(openFilesStore.getActiveId()).toBe("a.py");

    // Re-toggling the active file closes it.
    act(() => openFilesStore.toggle(a));
    expect(openFilesStore.getActiveId()).toBeNull();
    expect(openFilesStore.getFiles()).toHaveLength(0);
  });

  it("toggle opens a file that is not active, and switches between two open files", () => {
    const a = makeFile("a.py", "a.py");
    const b = makeFile("b.py", "b.py");
    act(() => openFilesStore.open(a));

    // Toggle b (not open) -> opens and activates it; a stays open (now MRU second).
    act(() => openFilesStore.toggle(b));
    expect(openFilesStore.getActiveId()).toBe("b.py");
    expect(openFilesStore.getFiles().map((f) => f.node_id)).toEqual(["b.py", "a.py"]);

    // Re-toggling b closes it and activates the next MRU file (a).
    act(() => openFilesStore.toggle(b));
    expect(openFilesStore.getActiveId()).toBe("a.py");
    expect(openFilesStore.getFiles().map((f) => f.node_id)).toEqual(["a.py"]);
  });

  it("closes a file via its tab close button", () => {
    const a = makeFile("a.py", "a.py");
    act(() => openFilesStore.open(a));
    render(<CodeSidebar hidden={false} />);

    act(() => screen.getByLabelText("Close a.py").click());
    // Sidebar hides again when nothing is open.
    expect(screen.queryByTestId("code-sidebar")).toBeNull();
  });

  it("closes a tab via the close glyph's keyboard (Enter)", () => {
    const a = makeFile("a.py", "a.py");
    act(() => openFilesStore.open(a));
    render(<CodeSidebar hidden={false} />);

    act(() => {
      fireEvent.keyDown(screen.getByLabelText("Close a.py"), { key: "Enter" });
    });
    expect(screen.queryByTestId("code-sidebar")).toBeNull();
  });

  it("activates a tab via keyboard (Enter/Space)", () => {
    const a = makeFile("a.py", "a.py");
    const b = makeFile("b.py", "b.py");
    act(() => openFilesStore.open(a));
    act(() => openFilesStore.open(b)); // b active (MRU front)
    render(<CodeSidebar hidden={false} />);

    // Focus the a tab (second tab) and press Enter -> a becomes active.
    const aTab = screen.getAllByTestId("code-sidebar-tab")[1];
    act(() => {
      fireEvent.keyDown(aTab, { key: "Enter" });
    });
    expect(openFilesStore.getActiveId()).toBe("a.py");
  });

  it("shows the overflow dropdown once more files are open than fit, with every file listed", () => {
    for (let i = 0; i < 10; i++) {
      act(() => openFilesStore.open(makeFile(`f${i}.py`, `f${i}.py`)));
    }
    render(<CodeSidebar hidden={false} />);

    // The overflow button is present.
    const overflow = screen.getByLabelText("Show all open files");
    act(() => overflow.click());

    // The dropdown lists every open file (scoped to the name span inside each menuitem, since tabs
    // also show names in MRU order and the close ✕ rides along in the item's raw textContent).
    const items = screen
      .getAllByRole("menuitem")
      .map((el) => el.querySelector(".code-sidebar-overflow-name")?.textContent);
    expect(items).toHaveLength(10);
    expect(items).toContain("f0.py");
    expect(items).toContain("f9.py");
  });
});
