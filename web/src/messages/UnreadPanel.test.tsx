import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { EngineClientProvider } from "../engine-client/EngineClientContext";
import type { EngineClient } from "../engine-client/EngineClient";
import * as client from "./messagesClient";
import type { UnreadFeed } from "./messagesClient";
import { BridgeHttpError } from "../util/httpJson";
import { MessagesRailButton, UnreadPanel } from "./UnreadPanel";
import { messagesStore } from "./messagesStore";

vi.mock("./messagesClient", () => ({
  getUnread: vi.fn(),
  refreshMessages: vi.fn(async () => ({ started: true })),
}));

const FEED: UnreadFeed = {
  sources: {
    slack: { state: "connected", error: null, synced_at: "2026-11-24T09:42:00Z" },
    outlook: { state: "error", error: "sign-in expired", synced_at: null },
  },
  items: [
    {
      id: "slack:T1/C1/1",
      source: "slack",
      where: "#backend",
      from: "Maya Chen",
      preview: "Three runs dropped nodes today",
      at: "2026-11-24T09:42:00Z",
      open_url: "slack://channel?team=T1&id=C1&message=1",
      web_url: "https://acme.slack.com/archives/C1/p1",
    },
    {
      id: "outlook:m1",
      source: "outlook",
      where: "Inbox",
      from: "Ana Ruiz",
      preview: "Release notes",
      at: "2026-11-24T09:41:30Z",
      open_url: "https://outlook.office.com/owa/?ItemID=m1",
      web_url: null,
    },
  ],
};

const stubEngineClient = { subscribeMessages: () => () => undefined } as unknown as EngineClient;

function renderWith(engine: EngineClient, children: ReactNode) {
  return render(<EngineClientProvider repoId="main" client={engine}>{children}</EngineClientProvider>);
}

beforeEach(() => {
  messagesStore.reset();
  vi.mocked(client.getUnread).mockResolvedValue(FEED);
});

afterEach(() => vi.restoreAllMocks());

describe("UnreadPanel", () => {
  it("badges the rail button with the unread count", async () => {
    renderWith(stubEngineClient, <MessagesRailButton />);

    expect((await screen.findByTestId("messages-badge")).textContent).toBe("2");
  });

  it("lists every unread item and a note for a failing source when opened", async () => {
    renderWith(stubEngineClient, <><MessagesRailButton /><UnreadPanel /></>);
    await screen.findByTestId("messages-badge");

    fireEvent.click(screen.getByTestId("messages-toggle-button"));

    expect(screen.getAllByRole("listitem").filter((li) => li.className === "unread-item")).toHaveLength(2);
    expect(screen.getByTestId("unread-note-outlook").textContent).toBe("Outlook: sign-in expired");
  });

  it("opens an item in its source app", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderWith(stubEngineClient, <><MessagesRailButton /><UnreadPanel /></>);
    await screen.findByTestId("messages-badge");
    act(() => messagesStore.open());

    fireEvent.click(screen.getByText("Maya Chen"));

    expect(open).toHaveBeenCalledWith("slack://channel?team=T1&id=C1&message=1", "_blank", "noopener");
  });

  it("re-fetches when the bridge pings messages-changed", async () => {
    let ping: () => void = () => undefined;
    const engine = { subscribeMessages: (onChange: () => void) => ((ping = onChange), () => undefined) } as unknown as EngineClient;
    renderWith(engine, <MessagesRailButton />);
    await screen.findByTestId("messages-badge");
    vi.mocked(client.getUnread).mockResolvedValue({ ...FEED, items: [FEED.items[0]] });

    act(() => ping());

    await waitFor(() => expect(screen.getByTestId("messages-badge").textContent).toBe("1"));
  });

  it("asks the bridge for a re-check on window focus", async () => {
    renderWith(stubEngineClient, <MessagesRailButton />);
    await screen.findByTestId("messages-badge");

    act(() => void window.dispatchEvent(new Event("focus")));

    expect(client.refreshMessages).toHaveBeenCalled();
  });

  it("hides the rail button on a bridge without the messages routes", async () => {
    vi.mocked(client.getUnread).mockRejectedValue(new BridgeHttpError("Not Found", 404));
    renderWith(stubEngineClient, <MessagesRailButton />);

    await waitFor(() => expect(screen.queryByTestId("messages-toggle-button")).toBeNull());

    expect(client.getUnread).toHaveBeenCalled();
  });

  it("points at Settings when nothing is connected", async () => {
    vi.mocked(client.getUnread).mockResolvedValue({
      sources: {
        slack: { state: "disconnected", error: null, synced_at: null },
        outlook: { state: "disconnected", error: null, synced_at: null },
      },
      items: [],
    });
    renderWith(stubEngineClient, <><MessagesRailButton /><UnreadPanel /></>);
    act(() => messagesStore.open());

    expect(await screen.findByText(/Settings › Integrations/)).toBeTruthy();
  });
});
