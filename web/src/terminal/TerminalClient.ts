/** Facade over the terminal WebSocket bridge (src/codechroma/terminal/server.py). UI components
 * depend on this interface, never on WebSocket details directly. */
export interface TerminalSession {
  write(data: string): void;
  /** Raw bytes from xterm's `onBinary` (mouse reports, paste in some modes) — not UTF-8 text. */
  writeBinary(data: string): void;
  resize(rows: number, cols: number): void;
  onData(callback: (data: string) => void): void;
  onClose(callback: () => void): void;
  close(): void;
}

export interface TerminalClient {
  /** Opens one PTY-attached session for the given allow-listed agent key (e.g. "claude"). Passing a
   * workspace id attaches to that agent's long-lived PTY on the bridge instead of spawning a new
   * one, so closing the window never kills the agent. */
  connect(agent: string, workspace?: string): TerminalSession;
}

export type TerminalFrame = { kind: "output"; data: string } | { kind: "error"; message: string };

/** Splits a bridge frame on its one-character tag: "o" is PTY output, "e" a JSON error envelope.
 * Tagged out of band on purpose — sniffing every frame for JSON swallowed any shell output that
 * happened to look like a control message, and cost a throwing JSON.parse per chunk. */
export function decodeFrame(frame: string): TerminalFrame {
  if (frame.startsWith("e")) {
    const body = frame.slice(1);
    try {
      const parsed = JSON.parse(body) as { message?: string };
      return { kind: "error", message: parsed?.message ?? "unknown error" };
    } catch {
      return { kind: "error", message: body || "unknown error" };
    }
  }
  // An untagged frame can only be an older bridge; render it rather than eating its first byte.
  return { kind: "output", data: frame.startsWith("o") ? frame.slice(1) : frame };
}

/** Base64 for a byte-per-char string, so raw input survives the JSON/UTF-8 hop to the PTY. */
function encodeBytes(data: string): string {
  return btoa(data);
}

export class WebSocketTerminalClient implements TerminalClient {
  constructor(private readonly baseUrl: string) {}

  connect(agent: string, workspace?: string): TerminalSession {
    const query = new URLSearchParams({ agent });
    if (workspace) query.set("workspace", workspace);
    const socket = new WebSocket(`${this.baseUrl}/ws/terminal?${query.toString()}`);
    let dataCallback: ((data: string) => void) | null = null;
    let closeCallback: (() => void) | null = null;
    let isOpen = false;
    const pending: string[] = [];

    const send = (payload: string): void => {
      if (isOpen) socket.send(payload);
      else pending.push(payload);
    };

    socket.addEventListener("open", () => {
      isOpen = true;
      pending.splice(0).forEach((payload) => socket.send(payload));
    });
    socket.addEventListener("message", (event) => {
      const frame = decodeFrame(event.data as string);
      dataCallback?.(
        frame.kind === "error" ? `\r\n[terminal error] ${frame.message}\r\n` : frame.data,
      );
    });
    socket.addEventListener("close", () => {
      closeCallback?.();
    });

    return {
      write(data) {
        send(JSON.stringify({ type: "input", data }));
      },
      writeBinary(data) {
        send(JSON.stringify({ type: "binary", data: encodeBytes(data) }));
      },
      resize(rows, cols) {
        send(JSON.stringify({ type: "resize", rows, cols }));
      },
      onData(callback) {
        dataCallback = callback;
      },
      onClose(callback) {
        closeCallback = callback;
      },
      close() {
        socket.close();
      },
    };
  }
}
