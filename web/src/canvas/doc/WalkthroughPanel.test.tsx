import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { WalkthroughPanel } from "./WalkthroughPanel";
import { DiagramFrame, PADDING } from "./DiagramFrame";
import { RouteCard } from "../RouteCard";
import { canvasDocStore } from "./canvasDocStore";
import { routeStore } from "../../state/routeStore";
import { measureBoxSize } from "./measureBoxSize";
import { CanvasNodeBox } from "./CanvasNodeBox";
import { boundsWithWalkthroughPanel, walkthroughPanelBox, walkthroughPanelHeight, WALKTHROUGH_PANEL } from "./walkthroughLayout";
import { EngineClientProvider } from "../../engine-client/EngineClientContext";
import { CANVAS_STUB } from "../../engine-client/stubEngineClient";
import type { EngineClient } from "../../engine-client/EngineClient";
import { EMPTY_CANVAS_DOC, type CanvasElement } from "../../state/types";
import type { Route, RouteStep } from "./routeStep";

const rawStep = (id: string, order: number, kind: string, node_ids: string[], detail?: string) =>
  ({ id, order, title: `Step ${id}`, kind, node_ids, children: [], detail });
const RAW_ROUTE = {
  id: "update-map",
  title: "Update the architecture map",
  summary: "3 steps · 2 files · 1 AI step",
  steps: [rawStep("click", 1, "trigger", []), rawStep("diff", 2, "decide", ["file::a"], "ComputeDelta()"), rawStep("ai", 3, "ai", ["file::b"], "SKILL.md, AI")],
};
const ROUTE: Route = {
  ...RAW_ROUTE,
  steps: RAW_ROUTE.steps.map(({ node_ids, ...s }) => ({ ...s, kind: s.kind as RouteStep["kind"], nodeIds: node_ids })),
};

function box(id: string, overrides: Partial<CanvasElement> = {}): CanvasElement {
  const step = RAW_ROUTE.steps.find((s) => s.id === id);
  return {
    id, render: "custom", layer: "walkthrough", label: `Box ${id}`, description: "", node_id: null,
    position: { x: 100, y: 100 + 100 * RAW_ROUTE.steps.indexOf(step!) }, size: { w: 160, h: 40 }, group_id: null,
    meta: { route_id: RAW_ROUTE.id, ...(step ? { route_step: step } : {}) }, created_by: "ai", ...overrides,
  };
}

const CARRIER: CanvasElement = { ...box("carrier"), render: "route", meta: { route_id: RAW_ROUTE.id, route: RAW_ROUTE } };
const MEMBERS = ["click", "diff", "ai"].map((id) => box(id));

function seed(members: CanvasElement[] = MEMBERS) {
  act(() => {
    canvasDocStore.setDoc({ ...EMPTY_CANVAS_DOC, elements: Object.fromEntries([CARRIER, ...members].map((el) => [el.id, el])) });
  });
}

afterEach(() => {
  routeStore.reset();
  canvasDocStore.reset();
});

describe("walkthrough panel layout", () => {
  it("sizes the panel exactly from its step count", () => {
    const p = WALKTHROUGH_PANEL;

    const height = walkthroughPanelHeight(ROUTE);

    expect(height).toBe(p.padding * 2 + p.head + 3 * p.row + 2 * p.rowGap + p.player + p.legend + p.sectionGap * 3);
  });

  it("places the panel right of the boxes and grows the frame bounds around it", () => {
    const bounds = { left: 0, top: 50, right: 500, bottom: 200 };

    const panel = walkthroughPanelBox(bounds, ROUTE);
    const grown = boundsWithWalkthroughPanel(bounds, ROUTE);

    expect(panel).toMatchObject({ left: 500 + WALKTHROUGH_PANEL.gap, top: 50, width: WALKTHROUGH_PANEL.width });
    expect(grown).toEqual({ left: 0, top: 50, right: panel.left + panel.width, bottom: 50 + panel.height });
  });
});

describe("walkthrough boxes use the common box internals", () => {
  it("renders the role row, name, description and path footer of a step box", () => {
    const step = box("diff", { label: "Diff vs manifest", description: "ComputeDelta()", node_id: "file::a", meta: { ...box("diff").meta, path: "src/a.cs" } });

    render(
      <EngineClientProvider repoId="default" client={CANVAS_STUB as unknown as EngineClient}>
        <CanvasNodeBox element={step} />
      </EngineClientProvider>,
    );

    expect(screen.getByTestId("canvas-node-box-name").textContent).toBe("Diff vs manifest");
    expect(screen.getByTestId("role-chip").textContent).toBe("COMPONENT");
    expect(screen.getByTestId("canvas-node-box-description").textContent).toBe("ComputeDelta()");
    expect(screen.getByTestId("canvas-node-box-foot").textContent).toContain("src/a.cs");
    expect(screen.getByTestId("canvas-node-box").className).toContain("route-step--decide");
  });

  it.each([
    [{ no_code_reason: "external" }, "EXTERNAL"],
    [{ no_code_reason: "conceptual", shape: "storage" }, "DATA"],
  ])("marks an off-route box %o through the common role row", (meta, role) => {
    const offRoute = box("other", { meta });

    render(
      <EngineClientProvider repoId="default" client={CANVAS_STUB as unknown as EngineClient}>
        <CanvasNodeBox element={offRoute} />
      </EngineClientProvider>,
    );

    expect(screen.getByTestId("role-chip").textContent).toBe(role);
  });

  it("measures a walkthrough box exactly like the same box on another layer", () => {
    const step = box("diff", { size: null, description: "ComputeDelta()" });

    const walkthrough = measureBoxSize(step);
    const other = measureBoxSize({ ...step, layer: "custom/x" });

    expect(walkthrough).toEqual(other);
  });
});

describe("WalkthroughPanel", () => {
  it("renders the ROUTE panel on the canvas right of the step boxes", () => {
    seed();

    render(<WalkthroughPanel layer="walkthrough" members={MEMBERS} sizes={new Map()} />);

    const panel = screen.getByTestId("walkthrough-panel");
    expect(panel.style.left).toBe(`${100 + 160 / 2 + WALKTHROUGH_PANEL.gap}px`);
    expect(panel.textContent).toContain("Update the architecture map");
    expect(screen.getAllByTestId("route-card-step")).toHaveLength(3);
    expect(screen.getByTestId("route-card-legend")).toBeTruthy();
  });

  it("shows the route over the code map and selects the step a row is clicked on", () => {
    seed();
    render(<WalkthroughPanel layer="walkthrough" members={MEMBERS} sizes={new Map()} />);

    fireEvent.click(screen.getAllByTestId("route-card-step")[1].querySelector("button")!);

    expect(routeStore.getSnapshot()).toMatchObject({ route: { id: "update-map" }, stepIndex: 1 });
    expect(screen.getAllByTestId("route-card-step")[1].className).toContain("route-card-step--active");
  });

  it("keeps the docked ROUTE card hidden for a route a walkthrough draws in its own frame", () => {
    seed();
    routeStore.show(ROUTE);

    render(<RouteCard />);

    expect(screen.queryByTestId("route-card")).toBeNull();
  });

  it("makes the diagram frame enclose the panel", () => {
    seed();
    const client = { ...CANVAS_STUB, getCanvas: async () => canvasDocStore.getDoc() } as unknown as EngineClient;

    render(
      <EngineClientProvider repoId="default" client={client}>
        <DiagramFrame layer="walkthrough" label="Walkthrough" members={MEMBERS} sizes={new Map()} />
      </EngineClientProvider>,
    );

    const frame = screen.getByTestId("canvas-diagram-frame");
    expect(frame.style.width).toBe(`${160 + WALKTHROUGH_PANEL.gap + WALKTHROUGH_PANEL.width + PADDING.side * 2}px`);
    expect(screen.getByTestId("show-route").textContent).toBe("Hide route");
    expect(screen.queryByTestId("route-legend")).toBeNull();
  });
});
