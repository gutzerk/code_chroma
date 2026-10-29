import { describe, expect, it } from "vitest";
import { routePathBetween } from "./routePath";

const box = (left: number, top: number, w = 160, h = 40) => ({ left, top, right: left + w, bottom: top + h });

describe("routePathBetween", () => {
  it("runs straight down between boxes that share a column", () => {
    expect(routePathBetween(box(300, 190), box(300, 310))).toBe("M 380 230 V 310");
  });

  it("runs straight across between boxes that share a row", () => {
    expect(routePathBetween(box(100, 100), box(500, 100))).toBe("M 260 120 H 500");
  });

  it("bends once between diagonal boxes", () => {
    expect(routePathBetween(box(60, 100, 150, 56), box(300, 190))).toBe("M 210 128 H 255 V 210 H 300");
  });

  it("leaves from the top edge when the next box is above", () => {
    expect(routePathBetween(box(300, 310), box(300, 190))).toBe("M 380 310 V 230");
  });
});
