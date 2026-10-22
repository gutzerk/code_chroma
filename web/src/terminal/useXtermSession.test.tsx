import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TerminalClientProvider } from "./TerminalClientContext";
import type { TerminalClient, TerminalSession } from "./TerminalClient";
import { useXtermSession, type XtermSessionOptions } from "./useXtermSession";

const { terminals, fit } = vi.hoisted(() => ({
  terminals: [] as { rows: number; cols: number; written: string[]; disposed: boolean }[],
  fit: { count: 0 },
}));

vi.mock("@xterm/xterm", () => {
  class Terminal {
    rows = 24;
    cols = 80;
    written: string[] = [];
    disposed = false;
    unicode = { activeVersion: "6" };
    constructor() {
      terminals.push(this);
    }
    loadAddon(): void {}
    attachCustomKeyEventHandler(): void {}
    open(): void {}
    focus(): void {}
    write(data: string): void {
      this.written.push(data);
    }
    onData(): void {}
    onBinary(): void {}
    onSelectionChange(): void {}
    getSelection(): string {
      return "";
    }
    dispose(): void {
      this.disposed = true;
    }
  }
  return { Terminal };
});
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit(): void {
      fit.count += 1;
    }
  },
}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss(): void {}
    clearTextureAtlas(): void {}
    dispose(): void {}
  },
}));

function fakeSession() {
  let onClose: (() => void) | null = null;
  const session = {
    write: vi.fn(),
    writeBinary: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn(),
    onClose: (cb: () => void) => {
      onClose = cb;
    },
    close: vi.fn(),
  };
  return { session: session as unknown as TerminalSession & typeof session, fireClose: () => onClose?.() };
}

let handle: ReturnType<typeof useXtermSession> | null = null;

function Host({ options }: { options: XtermSessionOptions }) {
  const ref = useRef<HTMLDivElement | null>(null);
  handle = useXtermSession(ref, options);
  return <div ref={ref} />;
}

function mount(connect: TerminalClient["connect"], options: Partial<XtermSessionOptions> = {}) {
  const full: XtermSessionOptions = { agent: "shell", closedNotice: "[closed]", ...options };
  const view = render(
    <TerminalClientProvider client={{ connect }}>
      <Host options={full} />
    </TerminalClientProvider>,
  );
  return view;
}

afterEach(() => {
  cleanup();
  terminals.length = 0;
  fit.count = 0;
  handle = null;
  vi.useRealTimers();
});

describe("useXtermSession", () => {
  it("connects with the agent and workspace and sends the initial size", () => {
    const { session } = fakeSession();
    const connect = vi.fn().mockReturnValue(session);

    mount(connect, { agent: "claude", workspace: "ws1" });

    expect(connect).toHaveBeenCalledWith("claude", "ws1");
    expect(session.resize).toHaveBeenCalledWith(24, 80);
  });

  it("stays torn down while disabled", () => {
    const connect = vi.fn();

    mount(connect, { enabled: false });

    expect(connect).not.toHaveBeenCalled();
    expect(terminals).toHaveLength(0);
  });

  it("writes the closed notice when the socket drops", () => {
    const { session, fireClose } = fakeSession();
    mount(() => session, { closedNotice: "[detached]" });

    fireClose();

    expect(terminals[0].written).toContain("[detached]");
  });

  it("closes the session and disposes the terminal on unmount", () => {
    const { session } = fakeSession();
    const view = mount(() => session);

    view.unmount();

    expect(session.close).toHaveBeenCalled();
    expect(terminals[0].disposed).toBe(true);
  });

  it("does not write the closed notice after unmount", () => {
    const { session, fireClose } = fakeSession();
    const view = mount(() => session);
    view.unmount();

    fireClose();

    expect(terminals[0].written).toEqual([]);
  });

  it("debounces refits and skips the PTY resize when the size is unchanged", () => {
    vi.useFakeTimers();
    const { session } = fakeSession();
    mount(() => session);
    session.resize.mockClear();
    fit.count = 0;

    handle?.scheduleRefit();
    handle?.scheduleRefit();
    handle?.scheduleRefit();
    vi.advanceTimersByTime(60);

    expect(fit.count).toBe(1);
    expect(session.resize).not.toHaveBeenCalled();
  });

  it("forwards a changed size to the PTY after the debounce", () => {
    vi.useFakeTimers();
    const { session } = fakeSession();
    mount(() => session);
    session.resize.mockClear();
    terminals[0].cols = 100;

    handle?.scheduleRefit();
    vi.advanceTimersByTime(60);

    expect(session.resize).toHaveBeenCalledWith(24, 100);
  });

  it("ignores a refit while the host measures 0x0", () => {
    vi.useFakeTimers();
    const { session } = fakeSession();
    mount(() => session);
    session.resize.mockClear();
    terminals[0].rows = 0;

    handle?.scheduleRefit();
    vi.advanceTimersByTime(60);

    expect(session.resize).not.toHaveBeenCalled();
  });
});
