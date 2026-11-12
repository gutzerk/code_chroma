import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachStickToBottom, pinTerminal, unpinTerminal, type StickyTerminal } from "./stickToBottom";

function fakeTerm(): StickyTerminal & { scroll(viewportY: number): void; output(): void; scrollToBottom: ReturnType<typeof vi.fn> } {
  const scrolls: (() => void)[] = [];
  const writes: (() => void)[] = [];
  const term = {
    buffer: { active: { viewportY: 100, baseY: 100 } },
    onScroll: (cb: () => void) => { scrolls.push(cb); return { dispose: () => scrolls.splice(scrolls.indexOf(cb), 1) }; },
    onWriteParsed: (cb: () => void) => { writes.push(cb); return { dispose: () => writes.splice(writes.indexOf(cb), 1) }; },
    scrollToBottom: vi.fn(() => { term.buffer.active.viewportY = term.buffer.active.baseY; }),
    scroll(viewportY: number) {
      term.buffer.active.viewportY = viewportY;
      scrolls.forEach((cb) => cb());
    },
    output() {
      writes.forEach((cb) => cb());
    },
  };
  return term;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("attachStickToBottom", () => {
  it("snaps back to the bottom when a scroll the user did not make moves a pinned terminal up", () => {
    const term = fakeTerm();
    attachStickToBottom(term, document.createElement("div"), () => false);

    term.scroll(70);

    expect(term.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(term.buffer.active.viewportY).toBe(100);
  });

  it("brings a pinned terminal back to the bottom after output lands while it is scrolled up", () => {
    const term = fakeTerm();
    attachStickToBottom(term, document.createElement("div"), () => false);
    term.buffer.active.viewportY = 60;
    term.buffer.active.baseY = 140;

    term.output();

    expect(term.buffer.active.viewportY).toBe(140);
  });

  it("stays where the user scrolled with the wheel and re-pins when they scroll back to the bottom", () => {
    const term = fakeTerm();
    const host = document.createElement("div");
    attachStickToBottom(term, host, () => false);

    host.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
    term.scroll(70);
    term.output();
    const stayed = term.buffer.active.viewportY;
    vi.advanceTimersByTime(1000);
    host.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
    term.scroll(100);
    vi.advanceTimersByTime(1000);
    term.scroll(40);

    expect(stayed).toBe(70);
    expect(term.buffer.active.viewportY).toBe(100);
  });

  it("keeps a scrollbar drag: scrolls while the pointer is held count as the user's", () => {
    const term = fakeTerm();
    const host = document.createElement("div");
    attachStickToBottom(term, host, () => false);

    host.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(2000);
    term.scroll(30);

    expect(term.scrollToBottom).not.toHaveBeenCalled();
  });

  it("does nothing while hidden, then shows a pinned terminal at the bottom", () => {
    const term = fakeTerm();
    let hidden = true;
    const sticky = attachStickToBottom(term, document.createElement("div"), () => hidden);

    term.scroll(10);
    const whileHidden = term.buffer.active.viewportY;
    hidden = false;
    sticky.shown();

    expect(whileHidden).toBe(10);
    expect(term.buffer.active.viewportY).toBe(100);
  });

  it("lets a prompt jump unpin the terminal and Latest pin it again", () => {
    const term = fakeTerm();
    attachStickToBottom(term, document.createElement("div"), () => false);

    unpinTerminal(term);
    term.scroll(20);
    term.output();
    const afterJump = term.buffer.active.viewportY;
    pinTerminal(term);

    expect(afterJump).toBe(20);
    expect(term.buffer.active.viewportY).toBe(100);
  });

  it("stops listening once detached", () => {
    const term = fakeTerm();
    const sticky = attachStickToBottom(term, document.createElement("div"), () => false);

    sticky.detach();
    term.scroll(50);

    expect(term.scrollToBottom).not.toHaveBeenCalled();
  });
});
