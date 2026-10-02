import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TerminalClientProvider } from "./TerminalClientContext";
import { terminalPanelStore } from "./terminalPanelStore";
import { TerminalPanel } from "./TerminalPanel";
import type { TerminalClient, TerminalSession } from "./TerminalClient";

const { fakeTerminals, fitCalls } = vi.hoisted(() => ({
  fakeTerminals: [] as FakeTerminal[],
  fitCalls: { count: 0 },
}));

interface FakeTerminal {
  rows: number;
  cols: number;
  written: string[];
  emitInput(data: string): void;
  emitSelectionChange(text: string): void;
}

vi.mock("@xterm/xterm", () => {
  class Terminal implements FakeTerminal {
    rows = 24;
    cols = 80;
    written: string[] = [];
    private dataHandler: ((data: string) => void) | null = null;
    private selectionHandler: (() => void) | null = null;
    private selectionText = "";

    constructor() {
      fakeTerminals.push(this);
    }

    unicode = { activeVersion: "6" };

    loadAddon(): void {}

    open(): void {}

    focus(): void {}

    write(data: string): void {
      this.written.push(data);
    }

    onData(callback: (data: string) => void): void {
      this.dataHandler = callback;
    }

    onBinary(): void {}

    onSelectionChange(callback: () => void): void {
      this.selectionHandler = callback;
    }

    getSelection(): string {
      return this.selectionText;
    }

    dispose(): void {}

    emitInput(data: string): void {
      this.dataHandler?.(data);
    }

    emitSelectionChange(text: string): void {
      this.selectionText = text;
      this.selectionHandler?.();
    }
  }
  return { Terminal };
});

vi.mock("@xterm/addon-fit", () => {
  class FitAddon {
    fit(): void {
      fitCalls.count += 1;
    }
  }
  return { FitAddon };
});

vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss(): void {}
    clearTextureAtlas(): void {}
    dispose(): void {}
  },
}));

function createFakeSession() {
  let dataCallback: ((data: string) => void) | null = null;
  let closeCallback: (() => void) | null = null;
  const writes: string[] = [];
  const session: TerminalSession & { emit: (data: string) => void; closed: boolean } = {
    closed: false,
    write: (data) => writes.push(data),
    writeBinary: (data) => writes.push(data),
    resize: () => {},
    onData: (callback) => {
      dataCallback = callback;
    },
    onClose: (callback) => {
      closeCallback = callback;
    },
    close: () => {
      session.closed = true;
      closeCallback?.();
    },
    emit: (data) => dataCallback?.(data),
  };
  return { session, writes };
}

function renderPanel(connect: TerminalClient["connect"], hidden = false) {
  return render(
    <TerminalClientProvider client={{ connect }}>
      <TerminalPanel hidden={hidden} />
    </TerminalClientProvider>,
  );
}

// A direct assignment (not vi.stubGlobal) so it only shadows the one property under test —
// navigator's other fields live on its prototype, so `{ ...navigator }` would silently drop them.
function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  fakeTerminals.length = 0;
  fitCalls.count = 0;
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
  terminalPanelStore.reset();
});

describe("TerminalPanel", () => {
  it("connects to the currently selected agent on mount", () => {
    const { session } = createFakeSession();
    const connect = vi.fn().mockReturnValue(session);

    renderPanel(connect);

    expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
    expect(connect).toHaveBeenCalledWith("shell", undefined);
  });

  it("writes incoming session output to the terminal", () => {
    const { session } = createFakeSession();
    renderPanel(() => session);

    session.emit("hello from agent");

    expect(fakeTerminals[0].written).toContain("hello from agent");
  });

  it("forwards terminal keystrokes to the session", () => {
    const { session, writes } = createFakeSession();
    renderPanel(() => session);

    fakeTerminals[0].emitInput("ls\n");

    expect(writes).toContain("ls\n");
  });

  it("copies a settled terminal selection to the clipboard", () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const { session } = createFakeSession();
    renderPanel(() => session);

    fakeTerminals[0].emitSelectionChange("hello from agent");
    vi.advanceTimersByTime(150);

    expect(writeText).toHaveBeenCalledWith("hello from agent");
  });

  it("debounces repeated selection changes into a single clipboard write", () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const { session } = createFakeSession();
    renderPanel(() => session);

    // A drag extends the selection on every cell; only the settled end state should be copied.
    fakeTerminals[0].emitSelectionChange("h");
    fakeTerminals[0].emitSelectionChange("he");
    fakeTerminals[0].emitSelectionChange("hello");
    vi.advanceTimersByTime(150);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("does not touch the clipboard when the selection is cleared", () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const { session } = createFakeSession();
    renderPanel(() => session);

    fakeTerminals[0].emitSelectionChange("");
    vi.advanceTimersByTime(150);

    expect(writeText).not.toHaveBeenCalled();
  });

  it("closes the session when the panel unmounts", () => {
    const { session } = createFakeSession();
    const { unmount } = renderPanel(() => session);

    unmount();

    expect(session.closed).toBe(true);
  });

  it("does not write to the terminal after unmount when the session closes", () => {
    const { session } = createFakeSession();
    const { unmount } = renderPanel(() => session);
    const term = fakeTerminals[0];

    unmount();

    expect(term.written).not.toContain("\r\n[session closed]\r\n");
  });

  it("keeps the session alive when hidden and reused when shown again", () => {
    const { session } = createFakeSession();
    const connect = vi.fn().mockReturnValue(session);
    const client = { connect };
    const { rerender } = render(
      <TerminalClientProvider client={client}>
        <TerminalPanel hidden={false} />
      </TerminalClientProvider>,
    );

    rerender(
      <TerminalClientProvider client={client}>
        <TerminalPanel hidden={true} />
      </TerminalClientProvider>,
    );
    expect(session.closed).toBe(false);
    expect(screen.getByTestId("terminal-panel")).toHaveClass("terminal-panel-hidden");

    rerender(
      <TerminalClientProvider client={client}>
        <TerminalPanel hidden={false} />
      </TerminalClientProvider>,
    );
    expect(session.closed).toBe(false);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("terminal-panel")).not.toHaveClass("terminal-panel-hidden");
  });

  it("debounces the refit so a drag burst collapses into a single reflow", () => {
    vi.useFakeTimers();
    const { session } = createFakeSession();
    renderPanel(() => session);
    const handle = screen.getByTestId("terminal-panel-resize-handle");
    const settled = fitCalls.count;

    // Vertical drag: the panel is a bottom dock, so its top-edge handle resizes height.
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 600, clientY: 600 });
    for (const clientY of [560, 520, 480, 440, 400]) {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600, clientY });
    }
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 600, clientY: 400 });

    // The burst of pointermoves must not each trigger a fit() while the timer is pending.
    expect(fitCalls.count).toBe(settled);

    vi.advanceTimersByTime(60);

    // The whole burst collapses into exactly one settled reflow.
    expect(fitCalls.count).toBe(settled + 1);
  });
});
