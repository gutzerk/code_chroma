import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { setDragAxisLock, setLockedDragEndListener } from "../canvas/dragAxisLock";
import { advanceTutorialFrom, useTutorialStep } from "./tutorialStore";

const TARGET = '[data-recipe-key="fn::add_todo"]';
const GAP = 12;

interface ArrowSpot {
  left: number;
  top: number;
  container: HTMLElement;
}

function measure(): ArrowSpot | null {
  const block = document.querySelector<HTMLElement>(TARGET);
  const container = document.querySelector<HTMLElement>(".canvas-content");
  if (!block || !container) return null;
  const left = parseFloat(block.style.left);
  const top = parseFloat(block.style.top);
  if (Number.isNaN(left) || Number.isNaN(top)) return null;
  return { left: left + block.offsetWidth / 2, top: top - GAP, container };
}

/** Lesson-only: a blinking arrow beside the block, and the drag allowed only that way. */
export function TutorialMoveArrow() {
  const active = useTutorialStep()?.id === "move-block";
  const [spot, setSpot] = useState<ArrowSpot | null>(null);

  useEffect(() => {
    if (!active) {
      setSpot(null);
      return;
    }
    setDragAxisLock("up");
    // Any released drag counts: the lock keeps it to the arrow's direction.
    setLockedDragEndListener(() => advanceTutorialFrom("move-block"));
    const update = () => setSpot(measure());
    update();
    const timer = window.setInterval(update, 300);
    return () => {
      window.clearInterval(timer);
      setDragAxisLock(null);
      setLockedDragEndListener(null);
    };
  }, [active]);

  if (!spot) return null;
  return createPortal(
    <div
      className="tutorial-move-arrow"
      data-testid="tutorial-move-arrow"
      aria-hidden="true"
      style={{ left: spot.left, top: spot.top }}
    >
      ↑
    </div>,
    spot.container,
  );
}
