import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ProjectTreePanel } from "./ProjectTreePanel";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import { expansionStore } from "../state/expansionState";
import { openFilesStore } from "./openFilesStore";
import type { EngineClient } from "../engine-client/EngineClient";
import type { HierarchyNodeRef } from "../state/types";

/** A shallow hierarchy: repo root containing one folder containing one file. Children load lazily
 * per-expand via TreeNode → useNodeChildren. */
const ROOT: HierarchyNodeRef = {
  node_id: "root",
  name: "repo",
  level: "folder",
  parent_id: null,
  has_children: true,
  child_count: 1,
};
const FOLDER: HierarchyNodeRef = {
  node_id: "folder",
  name: "src",
  level: "folder",
  parent_id: "root",
  has_children: true,
  child_count: 1,
};
const FILE: HierarchyNodeRef = {
  node_id: "file",
  name: "main.py",
  level: "file",
  parent_id: "folder",
  has_children: false,
  child_count: 0,
  source: "print('hi')",
  language: "python",
};

function client(overrides: Partial<EngineClient> = {}): EngineClient {
  return {
    getChildren: async (id: string) => (id === "root" ? [FOLDER] : id === "folder" ? [FILE] : []),
    getConnections: async () => [],
    subscribe: () => () => {},
    ...overrides,
  } as EngineClient;
}

afterEach(() => {
  expansionStore.reset();
  openFilesStore.reset();
  vi.restoreAllMocks();
});

function renderPanel(onActivate: () => void = vi.fn()) {
  return render(
    <EngineClientProvider repoId="default" client={client()}>
      <ProjectTreePanel rootNode={ROOT} hidden={false} onActivate={onActivate} />
    </EngineClientProvider>,
  );
}

describe("ProjectTreePanel", () => {
  it("renders the hierarchy root passed from RootCanvas", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("repo")).toBeTruthy());
  });

  it("lazily expands children on toggle, sharing the global expansion store", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("repo")).toBeTruthy());

    act(() => screen.getByText("repo").click());
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());

    // Expanding in panel state is global expansion store state (same surface as the canvas tree).
    expect(expansionStore.isVisible("root")).toBe(true);
  });

  it("calls onActivate when clicking a deep nested row, not just the root", async () => {
    const activate = vi.fn();
    renderPanel(activate);
    await waitFor(() => expect(screen.getByText("repo")).toBeTruthy());

    act(() => screen.getByText("repo").click());
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());
    act(() => screen.getByText("src").click());
    await waitFor(() => expect(screen.getByText("main.py")).toBeTruthy());

    // onActivate is threaded through recursive children, so a nested row activates.
    act(() => screen.getByText("main.py").click());
    expect(activate).toHaveBeenCalledWith("file");
  });

  it("does not navigate on a collapse, only on an expand or leaf", async () => {
    const activate = vi.fn();
    renderPanel(activate);
    await waitFor(() => expect(screen.getByText("repo")).toBeTruthy());

    // First click expands the root and navigates to it.
    act(() => screen.getByText("repo").click());
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());
    expect(activate).toHaveBeenCalledTimes(1);

    // A second click on the already-open root collapses it — that's a "put it away" gesture, so
    // no navigation occurs.
    act(() => screen.getByText("repo").click());
    expect(activate).toHaveBeenCalledTimes(1);

    // Navigating still works for a leaf row.
    act(() => screen.getByText("repo").click());
    act(() => screen.getByText("src").click());
    await waitFor(() => expect(screen.getByText("main.py")).toBeTruthy());
    act(() => screen.getByText("main.py").click());
    expect(activate).toHaveBeenCalledWith("file");
  });

  it("supports keyboard activation (Enter/Space) on a row", async () => {
    const activate = vi.fn();
    renderPanel(activate);
    await waitFor(() => expect(screen.getByText("repo")).toBeTruthy());

    const label = screen.getByText("repo").closest("[data-testid='tree-node-label']");
    expect(label).not.toBeNull();

    // Enter on the collapsed root expands it and navigates.
    act(() => {
      label!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    // Let the collapsed root's children fetch settle so the expansion paints (and activate runs).
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());
    expect(activate).toHaveBeenCalledWith("root");
  });

  it("opens a file's code by clicking its row, instead of a Show-code button", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("repo")).toBeTruthy());

    act(() => screen.getByText("repo").click());
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());
    act(() => screen.getByText("src").click());
    // The file row's name span (scoped to the tree name, not any copy in a code view).
    await waitFor(() => expect(screen.getByText("main.py")).toBeTruthy());
    const fileLabel = screen
      .getAllByText("main.py")
      .find((el) => el.className.includes("tree-node-name-file"));
    expect(fileLabel).toBeTruthy();

    // No Show-code button for the file (the panel reveals code on row click instead).
    expect(screen.queryByRole("button", { name: /Show file for main\.py/ })).toBeNull();

    // Clicking the file's name opens it in the code sidebar (the global openFilesStore MRU list).
    act(() => fileLabel!.click());
    await waitFor(() => expect(openFilesStore.getActiveId()).toBe("file"));
    await waitFor(() => expect(openFilesStore.getFiles().map((f) => f.node_id)).toEqual(["file"]));
  });

  it("marks every open file and highlights the active one in the code sidebar", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("repo")).toBeTruthy());
    act(() => screen.getByText("repo").click());
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());
    act(() => screen.getByText("src").click());
    const fileLabel = await waitFor(() =>
      screen
        .getAllByText("main.py")
        .find((el) => el.className.includes("tree-node-name-file")),
    );
    expect(fileLabel).toBeTruthy();

    const row = () => fileLabel!.closest(".tree-node")!;
    // Before opening, the row is neither open nor active.
    expect(row().classList.contains("tree-node-open-file")).toBe(false);
    expect(row().classList.contains("tree-node-active")).toBe(false);

    // Opening the file marks it open AND active.
    act(() => fileLabel!.click());
    await waitFor(() =>
      expect(row().classList.contains("tree-node-open-file")).toBe(true),
    );
    expect(row().classList.contains("tree-node-active")).toBe(true);
  });
});
