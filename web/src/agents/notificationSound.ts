/** Only `blocked` makes a sound: per the status mockup, error and done stay silent. */
export type StatusSoundKind = "blocked";

interface Tone {
  frequency: number;
  start: number;
  duration: number;
}

/** A rising two-tone "needs you", distinct by ear alone since the user may not be looking. */
const PATTERNS: Record<StatusSoundKind, Tone[]> = {
  blocked: [
    { frequency: 660, start: 0, duration: 0.12 },
    { frequency: 880, start: 0.12, duration: 0.16 },
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
export function playStatusSound(kind: StatusSoundKind = "blocked"): void {
  const ctx = audioContext();
  if (!ctx) return;
  void ctx.resume();

  const now = ctx.currentTime;
  for (const tone of PATTERNS[kind]) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
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
