import "@testing-library/jest-dom/vitest";

/** jsdom here ships a placeholder `window.localStorage` object with no methods, but the canvas's
 * collapsed-layers store persists to it. Back it with a real in-memory implementation so both that
 * store and its tests get the standard getItem/setItem/removeItem/clear contract. */
if (typeof window.localStorage?.setItem !== "function") {
  const backing = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string): string | null => backing.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        backing.set(key, String(value));
      },
      removeItem: (key: string): void => {
        backing.delete(key);
      },
      clear: (): void => {
        backing.clear();
      },
      key: (index: number): string | null => [...backing.keys()][index] ?? null,
      get length(): number {
        return backing.size;
      },
    },
  });
}


/** jsdom has no ResizeObserver — stub it so components that observe container size can mount. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}

/** jsdom has no Pointer Events capture API — stub it so CanvasViewport's pan gesture and the
 * canvas's reorder-drag gesture (both call setPointerCapture) can be exercised via fireEvent. */
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

/** jsdom has no PointerEvent constructor at all — @testing-library/dom's fireEvent.pointerDown/
 * Move/Up silently fall back to a bare Event when `window.PointerEvent` is missing, which drops
 * MouseEventInit fields like `button`/`clientX`/`clientY` (Event's constructor only recognizes
 * bubbles/cancelable/composed) as well as pointer-specific fields like `pointerId`. Polyfilling a
 * PointerEvent that extends MouseEvent (which jsdom does implement fully) lets those tests fire
 * real pointerdown/pointermove/pointerup sequences with working coordinates and pointer ids. */
if (!("PointerEvent" in globalThis)) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  (globalThis as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent =
    PointerEventPolyfill;
}
