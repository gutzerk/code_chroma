import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as client from "./messagesClient";
import type { Integrations } from "./messagesClient";
import { IntegrationsPanel } from "./IntegrationsPanel";

vi.mock("./messagesClient", () => ({
  getIntegrations: vi.fn(),
  getSlackManifest: vi.fn(async () => ({ oauth_config: { scopes: { user: ["im:history"] } } })),
  connectSlack: vi.fn(async () => ({ workspace: "Acme", user: "me" })),
  connectOutlook: vi.fn(async () => ({ auth_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1" })),
  disconnectSource: vi.fn(async () => ({})),
  getUnread: vi.fn(async () => ({ sources: {}, items: [] })),
}));

function status(overrides: Partial<Integrations> = {}): Integrations {
  return {
    slack: { connected: false, state: "disconnected", error: null, workspace: null, user: null },
    outlook: { connected: false, state: "disconnected", error: null, account: null, client_id: null, tenant: "common", default_client_available: true },
    token_storage: { backend: "libsecret", warning: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(client.getIntegrations).mockReset().mockResolvedValue(status());
  vi.mocked(client.connectSlack).mockClear();
});

describe("IntegrationsPanel", () => {
  it("sends both Slack tokens and shows the connected workspace", async () => {
    render(<IntegrationsPanel onDismiss={() => undefined} />);
    fireEvent.change(await screen.findByPlaceholderText("xoxp-…"), { target: { value: "xoxp-1" } });
    fireEvent.change(screen.getByPlaceholderText("xapp-…"), { target: { value: "xapp-1" } });
    vi.mocked(client.getIntegrations).mockResolvedValue(
      status({ slack: { connected: true, state: "connected", error: null, workspace: "Acme", user: "me" } }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }));

    expect((await screen.findByTestId("integrations-slack-connected")).textContent).toContain("Connected to Acme as me");
    expect(client.connectSlack).toHaveBeenCalledWith("xoxp-1", "xapp-1");
  });

  it("shows the bridge's refusal of a Slack token", async () => {
    vi.mocked(client.connectSlack).mockRejectedValueOnce(new Error("Slack refused the tokens: invalid_auth"));
    render(<IntegrationsPanel onDismiss={() => undefined} />);
    fireEvent.change(await screen.findByPlaceholderText("xoxp-…"), { target: { value: "xoxp-1" } });
    fireEvent.change(screen.getByPlaceholderText("xapp-…"), { target: { value: "xapp-1" } });

    fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Slack refused the tokens: invalid_auth");
  });

  it("opens the Microsoft sign-in in the browser", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<IntegrationsPanel onDismiss={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "Connect Outlook" }));

    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringContaining("login.microsoftonline.com"), "_blank", "noopener"));
  });

  it("stops waiting and shows the error when the sign-in fails", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<IntegrationsPanel onDismiss={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Outlook" }));
    await screen.findByRole("button", { name: "Waiting for sign-in…" });
    vi.mocked(client.getIntegrations).mockResolvedValue(
      status({ outlook: { connected: false, state: "error", error: "Microsoft sign-in was cancelled or refused: access_denied", account: null, client_id: null, tenant: "common", default_client_available: true } }),
    );

    const alert = await screen.findByRole("alert", {}, { timeout: 4000 });

    expect([alert.textContent, screen.getByRole("button", { name: "Connect Outlook" }) !== null]).toEqual([
      "Microsoft sign-in was cancelled or refused: access_denied",
      true,
    ]);
  });

  it("keeps waiting on a retry after an earlier sign-in failed", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const failed = status({ outlook: { connected: false, state: "error", error: "earlier failure", account: null, client_id: null, tenant: "common", default_client_available: true } });
    vi.mocked(client.getIntegrations).mockResolvedValueOnce(failed).mockResolvedValue(status());
    render(<IntegrationsPanel onDismiss={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "Connect Outlook" }));
    await waitFor(() => expect(vi.mocked(client.getIntegrations).mock.calls.length).toBeGreaterThanOrEqual(2));
    await act(async () => undefined);

    expect([screen.queryByRole("alert"), screen.queryByRole("button", { name: "Waiting for sign-in…" }) !== null]).toEqual([null, true]);
  });

  it("requires a client id when the build has no default one", async () => {
    vi.mocked(client.getIntegrations).mockResolvedValue(
      status({ outlook: { connected: false, state: "disconnected", error: null, account: null, client_id: null, tenant: "common", default_client_available: false } }),
    );
    render(<IntegrationsPanel onDismiss={() => undefined} />);

    await screen.findByText("Application (client) id");

    expect((screen.getByRole("button", { name: "Connect Outlook" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("warns when tokens are kept in a file instead of a keychain", async () => {
    vi.mocked(client.getIntegrations).mockResolvedValue(status({ token_storage: { backend: "file", warning: "No libsecret keyring" } }));

    render(<IntegrationsPanel onDismiss={() => undefined} />);

    expect((await screen.findByTestId("integrations-storage-warning")).textContent).toBe("No libsecret keyring");
  });

  it("says nothing is connected while neither source is", async () => {
    render(<IntegrationsPanel onDismiss={() => undefined} />);

    expect((await screen.findByTestId("integrations-none-connected")).textContent).toContain("No messenger is connected yet");
  });

  it("drops the not-connected notice once a source is connected", async () => {
    vi.mocked(client.getIntegrations).mockResolvedValue(
      status({ slack: { connected: true, state: "connected", error: null, workspace: "Acme", user: "me" } }),
    );

    render(<IntegrationsPanel onDismiss={() => undefined} />);

    await screen.findByTestId("integrations-slack-connected");
    expect(screen.queryByTestId("integrations-none-connected")).toBeNull();
  });
});
