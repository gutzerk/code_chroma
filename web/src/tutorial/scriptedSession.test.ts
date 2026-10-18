import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScriptedClient, type Scene } from "./scriptedSession";

const scene = (overrides: Partial<Scene> = {}): Scene => ({
  prompt: "go",
  question: "Which?",
  options: ["A", "B"],
  workLines: ["working"],
  doneLine: (choice) => `done ${choice}`,
  ...overrides,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function attach(client: ReturnType<typeof createScriptedClient>) {
  const output: string[] = [];
  const session = client.connect("claude", "tutorial");
  session.onData((data) => output.push(data));
  return { session, output };
}

describe("createScriptedClient", () => {
  it("passes the arrow-chosen option to onChosen and onDone", () => {
    const onChosen = vi.fn();
    const onDone = vi.fn();
    const client = createScriptedClient(() => {});
    const { session } = attach(client);
    client.play(scene({ onChosen, onDone }));
    vi.advanceTimersByTime(3000);

    session.write("\x1b[B");
    session.write("\r");
    vi.advanceTimersByTime(5000);

    expect(onChosen).toHaveBeenCalledWith(1);
    expect(onDone).toHaveBeenCalledWith(1);
  });

  it("types the prompt itself and waits for Enter before it starts work", () => {
    const onChosen = vi.fn();
    const client = createScriptedClient(() => {});
    const { session, output } = attach(client);
    client.play(scene({ confirm: true, question: undefined, options: undefined, onChosen }));
    vi.advanceTimersByTime(5000);
    const waitedFor = onChosen.mock.calls.length;

    session.write("\r");

    expect(output.join("")).toContain("go");
    expect(waitedFor).toBe(0);
    expect(onChosen).toHaveBeenCalledWith(0);
  });

  it("stops after its work lines and carries on only once resumed", () => {
    const onDone = vi.fn();
    const client = createScriptedClient(() => {});
    const { output } = attach(client);
    client.play(
      scene({ hold: true, question: undefined, options: undefined, resumeLines: ["after"], onDone }),
    );
    vi.advanceTimersByTime(20000);
    const stoppedAt = output.join("");

    client.resume();
    vi.advanceTimersByTime(20000);

    expect(stoppedAt).not.toContain("after");
    expect(output.join("")).toContain("after");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not stop at all when it was resumed before it got there", () => {
    const onDone = vi.fn();
    const client = createScriptedClient(() => {});
    attach(client);
    client.play(scene({ hold: true, question: undefined, options: undefined, onDone }));

    client.resume();
    vi.advanceTimersByTime(20000);

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("plays a scene again on a reconnect while it is unfinished", () => {
    const client = createScriptedClient(() => {});
    attach(client);
    client.play(scene());

    const { output } = attach(client);
    vi.advanceTimersByTime(3000);

    expect(output.join("")).toContain("Which?");
  });

  it("does not replay a finished scene on a reconnect", () => {
    const client = createScriptedClient(() => {});
    const first = attach(client);
    client.play(scene());
    vi.advanceTimersByTime(3000);
    first.session.write("\r");
    vi.advanceTimersByTime(5000);

    const { output } = attach(client);
    vi.advanceTimersByTime(3000);

    expect(output.join("")).not.toContain("Which?");
  });
});
