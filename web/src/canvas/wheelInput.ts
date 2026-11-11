import { clamp } from "../util/clamp";

/** The wheel fields the normalizer reads; `wheelDeltaY` is the legacy, non-standard 120-per-notch delta. */
export type WheelLike = Pick<WheelEvent, "deltaY" | "deltaX" | "deltaMode" | "ctrlKey"> & { wheelDeltaY?: number };

type WheelDevice = "mouse" | "trackpad";

// One mouse notch at sensitivity 1 zooms by e^0.18 ≈ 1.2x, whatever delta the OS/browser reports.
const MOUSE_NOTCH_LOG_STEP = 0.18;
// Trackpad deltas are already fine-grained pixels; this keeps the old feel at sensitivity 1.
const TRACKPAD_LOG_PER_PX = 0.0128;
// One trackpad event never zooms more than this (kills runaway jumps from momentum bursts).
const TRACKPAD_MAX_PX = 16;
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 800;
// A trackpad streams events ~16ms apart; anything this soon after a trackpad event is the same gesture.
const TRACKPAD_STREAM_MS = 120;

/** On when `?debugWheel=1` is in the URL or `localStorage["codechroma.debugWheel"] = "1"`; read once at load. */
const WHEEL_DEBUG = (() => {
  try {
    return (
      new URLSearchParams(window.location.search).get("debugWheel") === "1" ||
      window.localStorage.getItem("codechroma.debugWheel") === "1"
    );
  } catch {
    return false;
  }
})();

/** Converts one wheel delta in any deltaMode to pixels, so line-mode (Firefox) and pixel-mode wheels compare. */
export function deltaToPx(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * LINE_HEIGHT_PX;
  if (deltaMode === 2) return delta * PAGE_HEIGHT_PX;
  return delta;
}

function wheelDeltaPx(e: WheelLike): number {
  return deltaToPx(e.deltaY, e.deltaMode);
}

/** Notches from a true 120-step legacy delta, or null; WebKit's legacy delta is always 3x the pixel delta, so that case proves nothing. */
function legacyMouseNotches(e: WheelLike): number | null {
  const legacy = e.wheelDeltaY;
  if (typeof legacy !== "number" || legacy === 0 || legacy % 120 !== 0) return null;
  if (Math.abs(legacy) === Math.abs(Math.round(e.deltaY * 3))) return null;
  return Math.abs(legacy) / 120;
}

/** Best guess at the input device from one event: pinch, sideways motion, fractional or small deltas are a trackpad; line mode, a true 120-step legacy delta or a big integer delta is a mouse. */
export function classifyWheel(e: WheelLike): WheelDevice {
  if (e.ctrlKey) return "trackpad";
  if (e.deltaMode !== 0) return "mouse";
  if (e.deltaX !== 0 || !Number.isInteger(e.deltaY)) return "trackpad";
  if (legacyMouseNotches(e) !== null) return "mouse";
  return Math.abs(e.deltaY) >= 50 ? "mouse" : "trackpad";
}

/** Stateful classifier: keeps an ongoing trackpad stream on "trackpad" even when one event in it looks like a mouse notch. */
export function createWheelClassifier(now: () => number = () => performance.now()) {
  let lastTrackpadAt = -Infinity;
  return (e: WheelLike): WheelDevice => {
    const t = now();
    const device = t - lastTrackpadAt < TRACKPAD_STREAM_MS ? "trackpad" : classifyWheel(e);
    if (device === "trackpad") lastTrackpadAt = t;
    return device;
  };
}

/** Zoom factor for one wheel event: notch-normalized for a mouse, clamped pixel delta for a trackpad. */
export function wheelZoomFactor(
  e: WheelLike,
  sensitivity: { mouse: number; trackpad: number },
  device: WheelDevice = classifyWheel(e),
): number {
  const px = wheelDeltaPx(e);
  if (px === 0) return 1;
  if (device === "mouse") {
    const raw = legacyMouseNotches(e) ?? (e.deltaMode === 1 ? Math.abs(e.deltaY) / 3 : Math.abs(px) / 100);
    return Math.exp(-Math.sign(px) * clamp(raw, 0.25, 3) * MOUSE_NOTCH_LOG_STEP * sensitivity.mouse);
  }
  return Math.exp(-clamp(px, -TRACKPAD_MAX_PX, TRACKPAD_MAX_PX) * TRACKPAD_LOG_PER_PX * sensitivity.trackpad);
}

/** Zoom factor for one WebKit gesturechange step (Safari / macOS WKWebView pinch), scaled by trackpad sensitivity. */
export function pinchZoomFactor(previousScale: number, scale: number, sensitivity: number): number {
  if (!(previousScale > 0) || !(scale > 0)) return 1;
  return Math.pow(scale / previousScale, sensitivity);
}

/** Logs one input event's raw fields and outcome when wheel debugging is on (see WHEEL_DEBUG). */
export function logWheelInput(details: Record<string, unknown>): void {
  if (!WHEEL_DEBUG) return;
  console.info("[codechroma:wheel]", { ...details, dpr: window.devicePixelRatio, innerWidth: window.innerWidth });
}
