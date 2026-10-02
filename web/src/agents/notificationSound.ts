export type StatusSoundKind = "blocked" | "idle" | "exited";

interface Tone {
  frequency: number;
  start: number;
  duration: number;
}

/** One tone burst per kind -- distinct enough by ear alone, since the user may not be looking at the
 * screen when it plays. `blocked` rises (needs you), `idle` is a single bright chime (done), `exited`
 * falls on a harsher waveform (crashed). */
const PATTERNS: Record<StatusSoundKind, Tone[]> = {
  blocked: [
    { frequency: 660, start: 0, duration: 0.12 },
    { frequency: 880, start: 0.12, duration: 0.16 },
  ],
  idle: [{ frequency: 784, start: 0, duration: 0.18 }],
  exited: [
    { frequency: 220, start: 0, duration: 0.14 },
    { frequency: 165, start: 0.14, duration: 0.18 },
  ],
};

let sharedContext: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  return sharedContext;
}

/** Browsers refuse to start an AudioContext before a user gesture; the first pointerdown/keydown
 * anywhere unlocks it well before the first status change is likely to arrive. */
if (typeof document !== "undefined") {
  const unlock = () => void audioContext()?.resume();
  document.addEventListener("pointerdown", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
}

/** Synthesizes and plays the tone pattern for `kind`. Silently does nothing where Web Audio is
 * unavailable (e.g. jsdom in tests) rather than throwing. */
export function playStatusSound(kind: StatusSoundKind): void {
  const ctx = audioContext();
  if (!ctx) return;
  void ctx.resume();

  const now = ctx.currentTime;
  for (const tone of PATTERNS[kind]) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = kind === "exited" ? "sawtooth" : "sine";
    oscillator.frequency.value = tone.frequency;

    const start = now + tone.start;
    const end = start + tone.duration;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.2, start + 0.01);
    gain.gain.linearRampToValueAtTime(0, end);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}
