import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LeftPanel } from "./LeftPanel";
import { LEFT_MAX_WIDTH, LEFT_MIN_WIDTH, shellStore } from "./shellStore";

function renderPanel() {
  return render(<LeftPanel diagramsTab={<div>diagrams body</div>} filesTab={<div>files body</div>} />);
}

describe("LeftPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    shellStore.reset();
  });

  it("switches tabs and keeps both bodies mounted", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("tab", { name: "Files" }));

    expect(shellStore.getState().left.tab).toBe("files");
    expect(screen.getByText("files body").closest("[role=tabpanel]")).not.toHaveAttribute("hidden");
    expect(screen.getByText("diagrams body").closest("[role=tabpanel]")).toHaveAttribute("hidden");
  });

  it("collapses to the strip and reopens the clicked tab", () => {
    renderPanel();

    fireEvent.click(screen.getByLabelText("Collapse panel"));
    expect(screen.getByTestId("left-collapsed-strip")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Open Files"));

    expect(shellStore.getState().left).toMatchObject({ mode: "open", tab: "files" });
    expect(screen.getByTestId("left-panel")).toBeInTheDocument();
  });

  it("clamps the persisted width", () => {
    renderPanel();

    act(() => shellStore.setLeftWidth(10));
    expect(shellStore.getState().left.width).toBe(LEFT_MIN_WIDTH);
    act(() => shellStore.setLeftWidth(5000));

    expect(shellStore.getState().left.width).toBe(LEFT_MAX_WIDTH);
    expect(screen.getByTestId("left-panel")).toHaveStyle({ width: `${LEFT_MAX_WIDTH}px` });
  });
});
