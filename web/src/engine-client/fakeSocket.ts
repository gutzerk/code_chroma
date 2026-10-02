import { vi } from "vitest";

/** A minimal stand-in for the shared events socket, so a test can push a raw frame at the client or
 * drive its open/close lifecycle. Shared by every spec that stubs the socket rather than re-declared
 * per file: the client's reconnect backoff and its ping handling both need the same surface. */
export class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {}

  close(): void {}

  push(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

/** Replaces the global WebSocket with FakeSocket, returning the live list of sockets the client
 * opened — `sockets[0]` is the first connection, and a reconnect appends. */
export function stubWebSocket(): FakeSocket[] {
  const sockets: FakeSocket[] = [];
  vi.stubGlobal(
    "WebSocket",
    class extends FakeSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    },
  );
  return sockets;
}
