import { afterEach, expect, it } from "vitest";
import { dragOffsetStore } from "./dragOffsetStore";

afterEach(() => dragOffsetStore.reset());

it("setMany merges every entry and notifies subscribers exactly once", () => {
  let notifications = 0;
  const unsubscribe = dragOffsetStore.subscribe(() => notifications++);

  dragOffsetStore.setMany({ a: { x: 1, y: 1 }, b: { x: 2, y: 2 }, c: { x: 3, y: 3 } });

  // ONE notification for the whole batch -- a per-id `set` loop (the bug: a diagram-frame drag with
  // N members fanned out into N full-canvas re-render broadcasts per pointer-move frame) would have
  // notified 3 times here instead.
  expect(notifications).toBe(1);
  expect(dragOffsetStore.getAll()).toEqual({ a: { x: 1, y: 1 }, b: { x: 2, y: 2 }, c: { x: 3, y: 3 } });

  unsubscribe();
});

it("setMany leaves untouched ids alone and overwrites only the ids it's given", () => {
  dragOffsetStore.set("existing", { x: 0, y: 0 });

  dragOffsetStore.setMany({ existing: { x: 5, y: 5 }, fresh: { x: 9, y: 9 } });

  expect(dragOffsetStore.getAll()).toEqual({ existing: { x: 5, y: 5 }, fresh: { x: 9, y: 9 } });
});

it("setMany with no entries is a no-op that never notifies", () => {
  let notifications = 0;
  const unsubscribe = dragOffsetStore.subscribe(() => notifications++);

  dragOffsetStore.setMany({});

  expect(notifications).toBe(0);
  unsubscribe();
});
