import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UpdatesPanel, type UpdateState } from "./UpdatesPanel";
afterEach(() => { delete window.codechromaUpdates; });
function setup(phase: UpdateState["phase"]) {
  const state: UpdateState = { currentVersion: "1.0.0", latestVersion: "2.0.0", phase, bytes: 50, total: 100, error: phase === "error" ? "Download failed. Check your connection and try again." : undefined };
  const api = { state: vi.fn(async () => state), check: vi.fn(async () => state), download: vi.fn(async () => ({ ...state, phase: "ready" as const })), restart: vi.fn(async () => ({ ...state, phase: "installing" as const })), subscribe: vi.fn(() => vi.fn()) };
  window.codechromaUpdates = api;
  render(<UpdatesPanel onDismiss={vi.fn()} />);
  return api;
}
describe("UpdatesPanel", () => {
  it("shows installed and latest versions and up-to-date status", async () => {
    setup("up-to-date");
    expect(await screen.findByText("Up to date")).toBeTruthy();
    expect(screen.getByText("1.0.0")).toBeTruthy();
    expect(screen.getByText("2.0.0")).toBeTruthy();
  });
  it("offers the available version and downloads on click", async () => {
    const api = setup("available");
    fireEvent.click(await screen.findByText("Update to 2.0.0"));
    expect(await screen.findByText("Restart and Update")).toBeTruthy();
    expect(api.download).toHaveBeenCalledOnce();
    expect(api.restart).not.toHaveBeenCalled();
  });
  it("shows download progress", async () => {
    setup("downloading");
    expect(await screen.findByText("Downloading update…")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("50");
    expect(screen.getByText("Check for updates")).toBeDisabled();
  });
  it("offers explicit restart when ready", async () => {
    const api = setup("ready");
    fireEvent.click(await screen.findByText("Restart and Update"));
    await waitFor(() => expect(api.restart).toHaveBeenCalledOnce());
  });
  it("shows actionable error and retry", async () => {
    const api = setup("error");
    expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => expect(api.check).toHaveBeenCalledOnce());
  });
});
