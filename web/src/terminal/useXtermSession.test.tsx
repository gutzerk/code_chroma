import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { TerminalClientProvider } from "./TerminalClientContext";
import type { TerminalClient, TerminalSession } from "./TerminalClient";
import { fontChord, useXtermSession, type XtermSessionOptions } from "./useXtermSession";
import { terminalFontStore } from "./terminalFontStore";

const { terminals, fit, MEASURED } = vi.hoisted(() => {
  const MEASURED = { rows: 24, cols: 80 };
  return {
    MEASURED,
    terminals: [] as {
      rows: number;
      cols: number;
      written: string[];
      refreshed: [number, number][];
      disposed: boolean;
      options: { fontSize?: number; macOptionClickForcesSelection?: boolean };
      keyHandler: ((event: KeyboardEvent) => boolean) | null;
    }[],
    fit: { count: 0, proposed: MEASURED as { rows: number; cols: number } | undefined },
  };
});

vi.mock("@xterm/xterm", () => {
  class Terminal {
    rows = 24;
    cols = 80;
    written: string[] = [];
    refreshed: [number, number][] = [];
    disposed = false;
    unicode = { activeVersion: "6" };
    options: { fontSize?: number; macOptionClickForcesSelection?: boolean };
    keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
    constructor(options: { fontSize?: number } = {}) {
      this.options = { ...options };
      terminals.push(this);
    }
    loadAddon(): void {}
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
      this.keyHandler = handler;
    }
    open(): void {}
    focus(): void {}
    write(data: string): void {
      this.written.push(data);
    }
    refresh(start: number, end: number): void {
      this.refreshed.push([start, end]);
    }
    buffer = { active: { viewportY: 0, baseY: 0 } };
    onScroll(): { dispose(): void } {
      return { dispose() {} };
    }
    onWriteParsed(): { dispose(): void } {
      return { dispose() {} };
    }
    scrollToBottom(): void {}
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
    proposeDimensions(): { rows: number; cols: number } | undefined {
      return fit.proposed;
    }
  },
}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
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
  window.localStorage.removeItem("codechroma.terminalFont");
  terminalFontStore.reloadForTests();
  terminals.length = 0;
  fit.count = 0;
  fit.proposed = MEASURED;
  handle = null;
  vi.useRealTimers();
});

describe("useXtermSession", () => {
  it("redraws every row when the terminal is shown again", () => {
    const client = { connect: () => fakeSession().session };
    const host = (hidden: boolean) => (
      <TerminalClientProvider client={client}>
        <Host options={{ agent: "shell", closedNotice: "[closed]", hidden }} />
      </TerminalClientProvider>
    );
    const view = render(host(true));

    view.rerender(host(false));

    expect(terminals[0].refreshed).toContainEqual([0, 23]);
  });

  it("connects with the agent, workspace and measured size instead of a resize frame", () => {
    const { session } = fakeSession();
    const connect = vi.fn().mockReturnValue(session);

    mount(connect, { agent: "claude", workspace: "ws1" });

    expect(connect).toHaveBeenCalledWith("claude", "ws1", { rows: 24, cols: 80 });
    expect(session.resize).not.toHaveBeenCalled();
  });

  it.each([
    ["is hidden", undefined],
    ["is laid out at 0px", { rows: 1, cols: 2 }],
  ])("connects without a size while the host %s", (_name, proposed) => {
    fit.proposed = proposed;
    const { session } = fakeSession();
    const connect = vi.fn().mockReturnValue(session);

    mount(connect, { agent: "claude", workspace: "ws1" });

    expect(connect).toHaveBeenCalledWith("claude", "ws1", undefined);
    expect(session.resize).not.toHaveBeenCalled();
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

  it("sends no size while the box cannot be measured and sends the real one once shown", () => {
    vi.useFakeTimers();
    fit.proposed = undefined;
    const { session } = fakeSession();
    const client = { connect: () => session };
    const host = (hidden: boolean) => (
      <TerminalClientProvider client={client}>
        <Host options={{ agent: "shell", closedNotice: "[closed]", hidden }} />
      </TerminalClientProvider>
    );
    const view = render(host(true));
    const sentWhileHidden = session.resize.mock.calls.length;
    terminals[0].cols = 200;
    fit.proposed = MEASURED;

    view.rerender(host(false));
    vi.advanceTimersByTime(60);

    expect(sentWhileHidden).toBe(0);
    expect(session.resize).toHaveBeenCalledWith(24, 200);
  });

  it.each([
    ["is hidden", undefined],
    ["is laid out at 0px", { rows: 1, cols: 2 }],
  ])("ignores a refit while the host %s", (_name, proposed) => {
    vi.useFakeTimers();
    const { session } = fakeSession();
    mount(() => session);
    session.resize.mockClear();
    terminals[0].rows = 30;
    fit.proposed = proposed;

    handle?.scheduleRefit();
    vi.advanceTimersByTime(60);

    expect(session.resize).not.toHaveBeenCalled();
  });

  it("starts every terminal at the stored size with Option-click selection on", () => {
    terminalFontStore.set(15);

    mount(() => fakeSession().session);

    expect(terminals[0].options.fontSize).toBe(15);
    expect(terminals[0].options.macOptionClickForcesSelection).toBe(true);
  });

  it("applies a size change to every open terminal and refits them", () => {
    vi.useFakeTimers();
    const first = fakeSession();
    const second = fakeSession();
    const sessions = [first.session, second.session];
    const connect = () => sessions.shift()!;
    mount(connect);
    mount(connect);
    fit.count = 0;

    act(() => terminalFontStore.set(18));
    vi.advanceTimersByTime(60);

    expect(terminals.map((t) => t.options.fontSize)).toEqual([18, 18]);
    expect(fit.count).toBe(2);
  });

  it("handles Cmd/Ctrl+= in the terminal without sending it to the PTY", () => {
    const { session } = fakeSession();
    mount(() => session);
    terminalFontStore.set(12);
    const event = new KeyboardEvent("keydown", { key: "=", ctrlKey: true, metaKey: true, cancelable: true });

    const passed = terminals[0].keyHandler!(event);

    expect(passed).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(terminalFontStore.get()).toBe(13);
    expect(session.write).not.toHaveBeenCalled();
  });

  it.each([
    [{ key: "=", metaKey: true }, true, 1],
    [{ key: "+", metaKey: true }, true, 1],
    [{ key: "-", metaKey: true }, true, -1],
    [{ key: "0", metaKey: true }, true, 0],
    [{ key: "-", ctrlKey: true }, true, null],
    [{ key: "-", ctrlKey: true }, false, -1],
    [{ key: "=", metaKey: true, altKey: true }, true, null],
    [{ key: "a", metaKey: true }, true, null],
  ])("reads %o (mac %s) as the font chord %s", (keys, mac, expected) => {
    const event = { ctrlKey: false, metaKey: false, altKey: false, ...keys };

    const chord = fontChord(event, mac);

    expect(chord).toBe(expected);
  });
});
