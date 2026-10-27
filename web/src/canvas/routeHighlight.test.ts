import { describe, expect, it } from "vitest";
import { applyRouteHighlight } from "./routeHighlight";

function tree(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <div data-node-id="src"><div data-node-id="src/a"></div><div data-node-id="src/b"></div></div>
    <div data-node-id="docs"><div data-node-id="docs/x"></div></div>`;
  return root;
}
const at = (root: HTMLElement, id: string) => root.querySelector(`[data-node-id="${id}"]`) as HTMLElement;

describe("applyRouteHighlight", () => {
  it("lights the file and fades only the top-most unrelated blocks", () => {
    const root = tree();

    applyRouteHighlight(root, new Set(["src/a"]));

    expect(at(root, "src/a")).toHaveAttribute("data-route-lit");
    expect(at(root, "src")).not.toHaveAttribute("data-route-dim");
    expect(at(root, "src/b")).toHaveAttribute("data-route-dim");
    expect(at(root, "docs")).toHaveAttribute("data-route-dim");
    expect(at(root, "docs/x")).not.toHaveAttribute("data-route-dim");
  });

  it("removes every attribute on cleanup", () => {
    const root = tree();

    applyRouteHighlight(root, new Set(["src/a"]))();

    expect(root.querySelector("[data-route-lit],[data-route-dim]")).toBeNull();
  });
});
