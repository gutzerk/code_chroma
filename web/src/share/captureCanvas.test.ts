import { afterEach, describe, expect, it, vi } from "vitest";
import { contentBounds } from "./captureCanvas";

function rect(el: Element, r: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }) as DOMRect;
}

describe("contentBounds", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("covers only the nodes of the requested layers", () => {
    vi.stubGlobal("DOMMatrixReadOnly", class { a = 1; e = 0; f = 0; });
    const viewport = document.createElement("div");
    const content = document.createElement("div");
    viewport.append(content);
    const a = document.createElement("div");
    a.setAttribute("data-layer", "a");
    const b = document.createElement("div");
    b.setAttribute("data-layer", "b");
    content.append(a, b);
    rect(viewport, { left: 0, top: 0, width: 1000, height: 1000 });
    rect(a, { left: 10, top: 20, width: 100, height: 50 });
    rect(b, { left: 500, top: 600, width: 100, height: 50 });

    const bounds = contentBounds(content, new Set(["a"]));

    expect(bounds).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });
});
