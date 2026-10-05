import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UpdatesPanel, type UpdateState } from "./UpdatesPanel";

afterEach(() => { delete window.codechromaUpdates; });

function setup(phase: UpdateState["phase"], overrides: Partial<UpdateState> = {}) {
  const state: UpdateState = {
    currentVersion: "v0.6.0",
    latestVersion: "v0.7.0",
    phase,
    bytes: 50,
    total: 100,
    error: phase === "error" ? "Couldn't check for updates. Try again." : undefined,
    ...overrides,
  };
  const api = {
    state: vi.fn(async () => state),
    check: vi.fn(async () => state),
    download: vi.fn(async () => ({ ...state, phase: "ready" as const })),
    restart: vi.fn(async () => ({ ...state, phase: "installing" as const })),
    subscribe: vi.fn(() => vi.fn()),
  };
  const onDismiss = vi.fn();
  window.codechromaUpdates = api;
  render(<UpdatesPanel onDismiss={onDismiss} />);
  return { api, onDismiss };
}

describe("UpdatesPanel", () => {
  it("shows each available version once without a v prefix", async () => {
    setup("available");
    expect(await screen.findByRole("heading", { name: "Update available" })).toBeTruthy();
    expect(screen.getByText("A new stable version of Code Chroma is ready to install.")).toBeTruthy();
    expect(screen.getAllByText("0.6.0")).toHaveLength(1);
    expect(screen.getAllByText("0.7.0")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Update now" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Release notes on GitHub" }).getAttribute("target")).toBe("_blank");
  });

  it("shows only the current version when up to date", async () => {
    setup("up-to-date");
    expect(await screen.findByRole("heading", { name: "You're up to date" })).toBeTruthy();
    expect(screen.getAllByText("0.6.0")).toHaveLength(1);
    expect(screen.queryByText("0.7.0")).toBeNull();
    expect(screen.queryByRole("button", { name: "Update now" })).toBeNull();
    expect(document.querySelector(".updates-version-arrow")).toBeNull();
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeEnabled();
  });

  it("downloads on Update now and offers restart when ready", async () => {
    const { api } = setup("available");
    fireEvent.click(await screen.findByRole("button", { name: "Update now" }));
    expect(await screen.findByRole("button", { name: "Restart to finish updating" })).toBeTruthy();
    expect(api.download).toHaveBeenCalledOnce();
    expect(api.restart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Restart to finish updating" }));
    await waitFor(() => expect(api.restart).toHaveBeenCalledOnce());
  });

  it("shows download progress in place of the update button", async () => {
    setup("downloading");
    expect(await screen.findByText("Downloading…")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Download progress" }).getAttribute("value")).toBe("50");
    expect(screen.queryByRole("button", { name: "Update now" })).toBeNull();
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeDisabled();
  });

  it("shows Checking while the update check is active", async () => {
    setup("checking");
    expect(await screen.findByRole("button", { name: "Checking…" })).toBeDisabled();
  });

  it("shows inline errors and retries from Check for updates", async () => {
    const { api } = setup("error");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't check for updates");
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => expect(api.check).toHaveBeenCalledOnce());
  });

  it("closes when Back is pressed", async () => {
    const { onDismiss } = setup("available");
    fireEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
