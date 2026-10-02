import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChangeCardsPanel } from "./ChangeCardsPanel";
import type { ChangeCard } from "../state/types";

function card(overrides: Partial<ChangeCard> = {}): ChangeCard {
  return {
    id: "pricing.py::function::total",
    text: "Modified total",
    details: "",
    node_id: "function::total",
    kind: "modify",
    resolution: "exact",
    file: "pricing.py",
    symbol: "total",
    name: "total",
    target: "function",
    status: "modified",
    added_lines: 3,
    removed_lines: 1,
    binary: false,
    ...overrides,
  };
}

const CARDS: ChangeCard[] = [
  card(),
  card({
    id: "docs/README.md",
    text: "Added README.md",
    node_id: "function::total",
    kind: "add",
    resolution: "ancestor",
    file: "docs/README.md",
    symbol: null,
    name: "README.md",
    target: "file",
    status: "added",
    added_lines: 6,
    removed_lines: 0,
  }),
];

describe("ChangeCardsPanel", () => {
  it("renders nothing when there are no cards", () => {
    render(<ChangeCardsPanel cards={[]} />);

    expect(screen.queryByTestId("change-cards-panel")).not.toBeInTheDocument();
  });

  it("renders one card per change with its kind label and text", () => {
    render(<ChangeCardsPanel cards={CARDS} />);

    const cards = screen.getAllByTestId("change-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("data-kind", "modify");
    expect(cards[1]).toHaveAttribute("data-kind", "add");
    expect(screen.getByText("Modified total")).toBeInTheDocument();
  });

  it("counts the changes in its header", () => {
    render(<ChangeCardsPanel cards={CARDS} />);

    expect(screen.getByText("Changed here")).toBeInTheDocument();
    expect(screen.getByText("2 changes")).toBeInTheDocument();
  });

  it("uses the singular noun for one change", () => {
    render(<ChangeCardsPanel cards={[card()]} />);

    expect(screen.getByText("1 change")).toBeInTheDocument();
  });

  it("shows where each change is and how big it is", () => {
    render(<ChangeCardsPanel cards={CARDS} />);

    expect(screen.getByText("pricing.py · total · +3 −1")).toBeInTheDocument();
    expect(screen.getByText("docs/README.md · +6 −0")).toBeInTheDocument();
  });

  it("says binary instead of inventing line counts for undecodable content", () => {
    render(<ChangeCardsPanel cards={[card({ file: "logo.png", symbol: null, binary: true })]} />);

    expect(screen.getByText("logo.png · binary")).toBeInTheDocument();
  });

  it("shows a 'changed inside here' hint only for ancestor-resolved cards", () => {
    render(<ChangeCardsPanel cards={CARDS} />);

    expect(screen.getAllByText("changed inside here")).toHaveLength(1);
  });

  it("stamps its own node id and status for the change connector overlay", () => {
    render(<ChangeCardsPanel cards={CARDS} />);

    const panel = screen.getByTestId("change-cards-panel");
    expect(panel).toHaveAttribute("data-change-node-id", "function::total");
    expect(panel).toHaveAttribute("data-change-status", "new");
    expect(panel).not.toHaveAttribute("data-plan-node-id");
  });
});
