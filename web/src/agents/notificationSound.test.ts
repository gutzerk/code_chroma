import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { playStatusSound as PlayStatusSound } from "./notificationSound";

class FakeOscillator {
  type = "sine";
  frequency = { value: 0 };
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeGain {
  gain = {
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
}

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {});
  createOscillator = vi.fn(() => new FakeOscillator());
  createGain = vi.fn(() => new FakeGain());
}

/** The module caches one AudioContext at module scope, so each test needs its own fresh module
 * instance -- otherwise a later test's stubbed constructor is ignored in favor of an earlier test's
 * cached context. */
async function freshPlayStatusSound(): Promise<typeof PlayStatusSound> {
  vi.resetModules();
  const mod = await import("./notificationSound");
  return mod.playStatusSound;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("playStatusSound", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does nothing when Web Audio is unavailable", async () => {
    const playStatusSound = await freshPlayStatusSound();
    expect(() => playStatusSound("idle")).not.toThrow();
  });

  it("plays one oscillator for a single-tone pattern like idle", async () => {
    const ctx = new FakeAudioContext();
    vi.stubGlobal("AudioContext", vi.fn(() => ctx));
    const playStatusSound = await freshPlayStatusSound();

    playStatusSound("idle");

    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
  });

  it("plays two oscillators for a two-tone pattern like blocked or exited", async () => {
    const ctx = new FakeAudioContext();
    vi.stubGlobal("AudioContext", vi.fn(() => ctx));
    const playStatusSound = await freshPlayStatusSound();

    playStatusSound("blocked");

    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it("uses a harsher waveform for exited than for idle/blocked", async () => {
    const ctx = new FakeAudioContext();
    vi.stubGlobal("AudioContext", vi.fn(() => ctx));
    const oscillators: FakeOscillator[] = [];
    ctx.createOscillator.mockImplementation(() => {
      const oscillator = new FakeOscillator();
      oscillators.push(oscillator);
      return oscillator;
    });
    const playStatusSound = await freshPlayStatusSound();

    playStatusSound("exited");

    expect(oscillators.every((oscillator) => oscillator.type === "sawtooth")).toBe(true);
  });
});
