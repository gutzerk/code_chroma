import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RelationshipEdge } from "./RelationshipEdge";
import { hoveredEdgeStore } from "../../state/hoveredEdgeStore";

// In act, because the reset notifies subscribers while the edges of the finished test are still mounted.
afterEach(() => act(() => hoveredEdgeStore.reset()));

function renderEdges() {
  return render(
    <svg>
      <RelationshipEdge
        edgeKey="one"
        d="M 0 0 L 50 0"
        label="calls"
        labelX={25}
        labelY={0}
        markerId="c1-arrowhead"
        fromNodeId="c1-system"
        toNodeId="c1-actor::db"
        testId="c1-relationship"
      />
      <RelationshipEdge
        edgeKey="two"
        d="M 0 20 L 50 20"
        label="reads"
        labelX={25}
        labelY={20}
        markerId="c1-arrowhead"
        fromNodeId="c1-actor::user"
        toNodeId="c1-system"
        testId="c1-relationship"
      />
    </svg>,
  );
}

function groupFor(edgeKey: string): Element {
  const group = document.querySelector(`[data-edge-key="${edgeKey}"]`);
  if (!group) throw new Error(`no edge group for ${edgeKey}`);
  return group;
}

describe("RelationshipEdge", () => {
  it("renders a hit-stroke alongside the visible path so a 1px arrow is reachable", () => {
    renderEdges();

    expect(screen.getAllByTestId("c1-relationship-hit")).toHaveLength(2);
  });

  it("marks neither arrow active or dimmed while nothing is hovered", () => {
    renderEdges();

    expect(groupFor("one").getAttribute("class")).toBeNull();
    expect(groupFor("two").getAttribute("class")).toBeNull();
  });

  it("marks the hovered arrow active and every other arrow dimmed", () => {
    renderEdges();

    fireEvent.pointerEnter(groupFor("one").querySelector(".c1-relationship-hit")!);

    expect(groupFor("one").getAttribute("class")).toContain("c1-relationship--active");
    expect(groupFor("two").getAttribute("class")).toContain("c1-relationship--dimmed");
  });

  it("publishes the hovered arrow's endpoints so the blocks can accent with it", () => {
    renderEdges();

    fireEvent.pointerEnter(groupFor("one").querySelector(".c1-relationship-hit")!);

    expect(hoveredEdgeStore.getHovered()).toEqual({
      key: "one",
      fromNodeId: "c1-system",
      toNodeId: "c1-actor::db",
    });
  });

  it("restores every arrow when the pointer leaves", () => {
    renderEdges();
    const hit = groupFor("one").querySelector(".c1-relationship-hit")!;

    fireEvent.pointerEnter(hit);
    fireEvent.pointerLeave(hit);

    expect(groupFor("two").getAttribute("class")).toBeNull();
  });

  it("keeps the newly entered arrow active when the left arrow's pointerleave arrives late", () => {
    renderEdges();

    fireEvent.pointerEnter(groupFor("one").querySelector(".c1-relationship-hit")!);
    fireEvent.pointerEnter(groupFor("two").querySelector(".c1-relationship-hit")!);
    fireEvent.pointerLeave(groupFor("one").querySelector(".c1-relationship-hit")!);

    expect(groupFor("two").getAttribute("class")).toContain("c1-relationship--active");
  });

  it("keeps a change-review status class on the hovered arrow so the diff colour survives", () => {
    render(
      <svg>
        <RelationshipEdge
          edgeKey="added"
          d="M 0 0 L 50 0"
          label="calls"
          labelX={25}
          labelY={0}
          markerId="c1-arrowhead"
          fromNodeId="c1-system"
          toNodeId="c1-actor::db"
          changeStatus="added"
          testId="c1-relationship"
        />
      </svg>,
    );

    fireEvent.pointerEnter(screen.getByTestId("c1-relationship-hit"));

    expect(groupFor("added").getAttribute("class")).toBe(
      "c1-relationship--added c1-relationship--active",
    );
  });

  it("adds the internal variant class to the stroke and the caption", () => {
    render(
      <svg>
        <RelationshipEdge
          edgeKey="inner"
          d="M 0 0 L 50 0"
          label="calls"
          labelX={25}
          labelY={0}
          markerId="c1-internal-arrowhead"
          fromNodeId="c1-sub::system/a"
          toNodeId="c1-sub::system/b"
          variantSuffix="--internal"
          testId="c1-internal-relationship"
        />
      </svg>,
    );

    expect(document.querySelector(".c1-relationship-path--internal")).not.toBeNull();
    expect(document.querySelector(".c1-relationship-label--internal")).not.toBeNull();
  });

  it("adds the hero variant class and data-hero when isHero is set", () => {
    render(
      <svg>
        <RelationshipEdge
          edgeKey="hero-edge"
          d="M 0 0 L 50 0"
          label="charges through"
          labelX={25}
          labelY={0}
          markerId="impact-arrowhead"
          fromNodeId="orders"
          toNodeId="payment-client"
          isHero
          testId="impact-relationship"
        />
      </svg>,
    );

    expect(document.querySelector(".c1-relationship-path--hero")).not.toBeNull();
    expect(document.querySelector(".c1-relationship-label--hero")).not.toBeNull();
    expect(groupFor("hero-edge")).toHaveAttribute("data-hero", "true");
  });

  it("omits data-hero and the hero classes when isHero is not set", () => {
    renderEdges();

    expect(groupFor("one")).not.toHaveAttribute("data-hero");
    expect(document.querySelector(".c1-relationship-path--hero")).toBeNull();
  });

  it("surfaces an authored color as the inheritable --edge-color custom property", () => {
    render(
      <svg>
        <RelationshipEdge
          edgeKey="colored"
          d="M 0 0 L 50 0"
          label="calls"
          labelX={25}
          labelY={0}
          markerId="impact-arrowhead"
          fromNodeId="orders"
          toNodeId="payment-client"
          style={{ color: "#ff5500" }}
          testId="impact-relationship"
        />
      </svg>,
    );

    const group = groupFor("colored");
    // Custom properties pass through unserialized, so the authored hex survives as-is.
    expect(group.getAttribute("style")).toContain("--edge-color: #ff5500");
  });

  it("sets no inline style when no color is authored", () => {
    renderEdges();

    expect(groupFor("one").getAttribute("style")).toBeNull();
  });

  it("passes the authored transport through to the edge's label", () => {
    render(
      <svg>
        <RelationshipEdge
          edgeKey="mcp"
          d="M 0 0 L 50 0"
          label="Sends tool calls"
          transport="mcp"
          labelX={25}
          labelY={0}
          markerId="c1-arrowhead"
          fromNodeId="c1-system"
          toNodeId="c1-actor::mcp"
          testId="c1-relationship"
        />
      </svg>,
    );

    expect(groupFor("mcp").querySelector(".c1-relationship-label__transport")).toHaveTextContent(
      "mcp",
    );
  });
});
