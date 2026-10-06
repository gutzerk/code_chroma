import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDragOffset } from "./useDragOffset";

function Box({ onClick }: { onClick: () => void }) {
  const { handleProps } = useDragOffset({ suppressClickAfterDrag: true });
  return <div data-testid="box" onClick={onClick} {...handleProps} />;
}

function press(box: HTMLElement, dx: number) {
  fireEvent.pointerDown(box, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: dx, clientY: 0 });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: dx, clientY: 0 });
  fireEvent.click(box);
}

describe("useDragOffset click suppression", () => {
  it("keeps the click when the pointer stays under the drag threshold", () => {
    const onClick = vi.fn();
    render(<Box onClick={onClick} />);

    press(screen.getByTestId("box"), 2);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("swallows the click once the pointer has moved past the drag threshold", () => {
    const onClick = vi.fn();
    render(<Box onClick={onClick} />);

    press(screen.getByTestId("box"), 6);

    expect(onClick).not.toHaveBeenCalled();
  });
});
