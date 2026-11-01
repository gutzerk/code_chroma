/** A box in the overlay's local coordinates. */
export interface LocalBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlap = (aLo: number, aHi: number, bLo: number, bHi: number): [number, number] | null => {
  const lo = Math.max(aLo, bLo);
  const hi = Math.min(aHi, bHi);
  return lo < hi ? [lo, hi] : null;
};

/** The route's connector between two boxes: one straight run when they overlap on an axis, else an H-V-H elbow. */
export function routePathBetween(a: LocalBox, b: LocalBox): string {
  const x = overlap(a.left, a.right, b.left, b.right);
  if (x) {
    const mid = (x[0] + x[1]) / 2;
    const down = b.top >= a.bottom;
    return `M ${mid} ${down ? a.bottom : a.top} V ${down ? b.top : b.bottom}`;
  }
  const y = overlap(a.top, a.bottom, b.top, b.bottom);
  const right = b.left >= a.right;
  const fromX = right ? a.right : a.left;
  const toX = right ? b.left : b.right;
  if (y) {
    const mid = (y[0] + y[1]) / 2;
    return `M ${fromX} ${mid} H ${toX}`;
  }
  const fromY = (a.top + a.bottom) / 2;
  const toY = (b.top + b.bottom) / 2;
  return `M ${fromX} ${fromY} H ${(fromX + toX) / 2} V ${toY} H ${toX}`;
}
