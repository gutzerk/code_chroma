import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkillOutputFeed } from "./SkillOutputFeed";

describe("SkillOutputFeed", () => {
  it("renders each progress line in order", () => {
    render(<SkillOutputFeed lines={["⏺ Read(app.py)", "✓ done in 5s"]} />);

    const feed = screen.getByTestId("skill-output-feed");
    expect(feed.textContent).toBe("⏺ Read(app.py)✓ done in 5s");
  });

  it("shows a placeholder while waiting for the first line, so the panel is never blank", () => {
    render(<SkillOutputFeed lines={[]} />);

    const feed = screen.getByTestId("skill-output-feed");
    expect(feed).toBeInTheDocument();
    expect(feed.textContent).toContain("waiting for agent output");
  });

  it("takes a caller-supplied test id, so the two runs' feeds are distinguishable", () => {
    render(<SkillOutputFeed lines={["⏺ Read(app.py)"]} testId="c1-generation-output" />);

    expect(screen.getByTestId("c1-generation-output")).toBeInTheDocument();
  });

  it("keeps identical lines as separate rows rather than collapsing them", () => {
    render(<SkillOutputFeed lines={["⏺ Read(app.py)", "⏺ Read(app.py)"]} />);

    expect(screen.getByTestId("skill-output-feed").children).toHaveLength(2);
  });

  it("swallows wheel events, so scrolling the log does not zoom the canvas underneath", () => {
    const onCanvasWheel = vi.fn();
    render(
      <div onWheel={onCanvasWheel}>
        <SkillOutputFeed lines={["⏺ Read(app.py)"]} />
      </div>,
    );

    screen
      .getByTestId("skill-output-feed")
      .dispatchEvent(new WheelEvent("wheel", { bubbles: true }));

    expect(onCanvasWheel).not.toHaveBeenCalled();
  });

  it("scrolls to the newest line while the user is at the bottom", () => {
    const { rerender } = render(<SkillOutputFeed lines={["one"]} />);
    const feed = screen.getByTestId("skill-output-feed");
    // jsdom has no layout, so the scroll geometry the effect reads has to be supplied.
    Object.defineProperty(feed, "scrollHeight", { value: 500, configurable: true });

    rerender(<SkillOutputFeed lines={["one", "two"]} />);

    expect(feed.scrollTop).toBe(500);
  });

  it("stops following once the user has scrolled back to read", () => {
    const { rerender } = render(<SkillOutputFeed lines={["one"]} />);
    const feed = screen.getByTestId("skill-output-feed");
    Object.defineProperty(feed, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(feed, "clientHeight", { value: 100, configurable: true });
    feed.scrollTop = 0;
    feed.dispatchEvent(new Event("scroll", { bubbles: true }));

    rerender(<SkillOutputFeed lines={["one", "two"]} />);

    expect(feed.scrollTop).toBe(0);
  });
});
