import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collisionStore } from "./collisionStore";
import { NODE_SEP, RANK_SEP } from "./constants";

let canvasContent: HTMLDivElement;

/** A participant inside `.canvas-content` whose on-screen rectangle is whatever the caller says —
 * jsdom lays nothing out, and these are exactly the screen pixels the store has to divide by scale. */
function participant(id: string, screenRect: [number, number, number, number]): HTMLDivElement {
  const element = document.createElement("div");
  canvasContent.appendChild(element);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(screenRect[0], screenRect[1], screenRect[2], screenRect[3]),
  );
  collisionStore.register(id, () => element);
  return element;
}

beforeEach(() => {
  canvasContent = document.createElement("div");
  canvasContent.className = "canvas-content";
  document.body.appendChild(canvasContent);
});

afterEach(() => {
  collisionStore.reset();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("collisionStore", () => {
  it("divides screen pixels by the canvas scale, so a zoomed-out gap is still NODE_SEP", () => {
    // At zoom 0.5, screen pixels are half of canvas coordinates, so a screen gap of NODE_SEP / 2
    // apart becomes NODE_SEP once divided back into canvas coordinates.
    participant("a", [0, 0, 120, 36]);
    participant("b", [120 + NODE_SEP / 2, 0, 120, 36]);

    const [obstacle] = collisionStore.rectsExcept("a", 0.5);

    expect(obstacle).toMatchObject({ id: "b", x: 240 + NODE_SEP, y: 0, width: 240, height: 72 });
    expect(obstacle.x - 240).toBe(NODE_SEP);
  });

  it("keeps a zoomed-out vertical gap at RANK_SEP in canvas coordinates", () => {
    participant("a", [0, 0, 120, 36]);
    participant("b", [0, 36 + RANK_SEP / 2, 120, 36]);

    const [obstacle] = collisionStore.rectsExcept("a", 0.5);

    expect(obstacle.y - 72).toBe(RANK_SEP);
  });

  it("never reports the dragged block as its own obstacle", () => {
    participant("a", [0, 0, 240, 72]);
    participant("b", [300, 0, 240, 72]);

    const obstacles = collisionStore.rectsExcept("a", 1);

    expect(obstacles.map((obstacle) => obstacle.id)).toEqual(["b"]);
  });

  it("drops a participant the dragged element is nested inside, and vice versa", () => {
    const outer = participant("outer", [0, 0, 400, 400]);
    const inner = document.createElement("div");
    outer.appendChild(inner);
    vi.spyOn(inner, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 10, 100, 100));
    collisionStore.register("inner", () => inner);
    participant("other", [900, 0, 240, 72]);

    const forInner = collisionStore.rectsExcept("inner", 1, inner);
    const forOuter = collisionStore.rectsExcept("outer", 1, outer);

    expect(forInner.map((obstacle) => obstacle.id)).toEqual(["other"]);
    expect(forOuter.map((obstacle) => obstacle.id)).toEqual(["other"]);
  });

  it("ignores an unlaid-out participant instead of treating it as a box at the origin", () => {
    participant("a", [0, 0, 240, 72]);
    participant("empty", [0, 0, 0, 0]);

    const obstacles = collisionStore.rectsExcept("a", 1);

    expect(obstacles).toEqual([]);
  });

  it("ignores a participant outside the zoom transform, whose pixels are screen pixels", () => {
    participant("a", [0, 0, 240, 72]);
    const screenPanel = document.createElement("div");
    document.body.appendChild(screenPanel);
    vi.spyOn(screenPanel, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
    collisionStore.register("popup", () => screenPanel);

    const obstacles = collisionStore.rectsExcept("a", 1);

    expect(obstacles).toEqual([]);
  });

  it("frees a closed panel's space the moment it unregisters", () => {
    participant("a", [0, 0, 240, 72]);
    const unregister = collisionStore.register("panel", () => {
      const element = document.createElement("div");
      canvasContent.appendChild(element);
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(300, 0, 240, 72));
      return element;
    });

    const before = collisionStore.rectsExcept("a", 1);
    unregister();

    expect(before.map((obstacle) => obstacle.id)).toEqual(["panel"]);
    expect(collisionStore.rectsExcept("a", 1)).toEqual([]);
  });

  it("holds the frozen rectangles for the whole gesture rather than re-reading them per frame", () => {
    participant("a", [0, 0, 240, 72]);
    const moving = participant("b", [300, 0, 240, 72]);
    collisionStore.beginGesture(1);

    vi.spyOn(moving, "getBoundingClientRect").mockReturnValue(new DOMRect(9000, 9000, 240, 72));
    const duringGesture = collisionStore.rectsExcept("a", 1);
    collisionStore.endGesture();

    expect(duringGesture[0].x).toBe(300);
    expect(collisionStore.rectsExcept("a", 1)[0].x).toBe(9000);
  });
});
