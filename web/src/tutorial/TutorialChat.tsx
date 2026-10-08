import { useEffect, useRef, useState } from "react";
import { tutorialStore, useTutorialStep } from "./tutorialStore";
import runAgentIcon from "../icons/run-agent.svg";
import { TUTORIAL_STAGES, TUTORIAL_STEPS, type TutorialStep } from "./tutorialSteps";
import "./tutorial.css";

const CHAT_WIDTH = 330;
const GAP = 16;
const TYPE_INTERVAL_MS = 16;
const GUARDED_EVENTS = ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "contextmenu"];

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

function unionBox(elements: Element[]): Box | null {
  const rects = elements.map((element) => element.getBoundingClientRect());
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, width: right - left, height: bottom - top };
}

function chatPosition(
  step: TutorialStep,
  box: Box | null,
): { left: number; top: number; placement: TutorialStep["placement"] } {
  if (step.placement === "corner") {
    return {
      left: window.innerWidth - CHAT_WIDTH - 24,
      top: window.innerHeight - 260,
      placement: "corner",
    };
  }
  if (!box || step.placement === "center") {
    return {
      left: (window.innerWidth - CHAT_WIDTH) / 2,
      top: window.innerHeight * 0.3,
      placement: "center",
    };
  }
  // A "left" chat with no room beside the target would cover it, so it flips to the target's right.
  const placement =
    step.placement === "left" && box.left - CHAT_WIDTH - GAP < GAP ? "right" : step.placement;
  const right = Math.min(box.left + box.width + GAP, window.innerWidth - CHAT_WIDTH - GAP);
  const placed = {
    corner: 0,
    center: 0,
    bottom: box.left,
    left: box.left - CHAT_WIDTH - GAP,
    right,
  };
  const top = placement === "bottom" ? box.top + box.height + GAP : box.top + box.height / 2 - 36;
  return {
    left: placed[placement],
    top: Math.max(GAP, Math.min(top, window.innerHeight - 220)),
    placement,
  };
}

function StageProgress({ step }: { step: TutorialStep }) {
  const sameStage = TUTORIAL_STEPS.filter((candidate) => candidate.stage === step.stage);
  const doneInStage = sameStage.indexOf(step) / sameStage.length;
  return (
    <div className="tutorial-progress" role="tablist" aria-label="Tutorial stages">
      {TUTORIAL_STAGES.map((title, index) => {
        const stage = index + 1;
        const available = TUTORIAL_STEPS.some((candidate) => candidate.stage === stage);
        const fill = stage < step.stage ? 1 : stage === step.stage ? doneInStage : 0;
        return (
          <button
            key={title}
            type="button"
            role="tab"
            aria-selected={stage === step.stage}
            className={`tutorial-progress-segment${stage === step.stage ? " is-current" : ""}`}
            data-testid={`tutorial-stage-${stage}`}
            disabled={!available}
            title={
              available ? `Stage ${stage}: ${title}` : `Stage ${stage}: ${title} (coming soon)`
            }
            onClick={() => tutorialStore.goToStage(stage)}
          >
            <span className="tutorial-progress-fill" style={{ width: `${fill * 100}%` }} />
          </button>
        );
      })}
    </div>
  );
}

/** Typed-out guide chat that points at one element and lets only that element be clicked. */
export function TutorialChat() {
  const step = useTutorialStep();
  const chatRef = useRef<HTMLDivElement>(null);
  const [typedState, setTypedState] = useState({ id: "", text: "" });
  const typed = typedState.id === step?.id ? typedState.text : "";
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!step) return;
    step.onEnter?.();
    let length = 0;
    const timer = window.setInterval(() => {
      length += 1;
      setTypedState({ id: step.id, text: step.text.slice(0, length) });
      if (length >= step.text.length) window.clearInterval(timer);
    }, TYPE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [step]);

  useEffect(() => {
    if (!step) return;
    let frame = 0;
    const track = () => {
      const elements = step.target
        ? Array.from(
            step.locked
              ? document.querySelectorAll(step.target)
              : [document.querySelector(step.target)],
          ).filter((element): element is Element => element !== null)
        : [];
      const next = unionBox(elements);
      setBox((previous) => (sameBox(previous, next) ? previous : next));
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    if (!step) return;
    const guard = (event: Event) => {
      const clicked = event.target as Element | null;
      if (clicked && chatRef.current?.contains(clicked)) return;
      const target = step.target ? document.querySelector(step.target) : null;
      if (!step.locked && clicked && target?.contains(clicked)) {
        if (event.type === "click" && step.advance === "click") {
          window.setTimeout(tutorialStore.next, 0);
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    for (const name of GUARDED_EVENTS) document.addEventListener(name, guard, true);
    return () => {
      for (const name of GUARDED_EVENTS) document.removeEventListener(name, guard, true);
    };
  }, [step]);

  if (!step) return null;
  const position = chatPosition(step, box);
  return (
    <>
      {box && !step.quiet && (
        <div
          className="tutorial-highlight"
          data-testid="tutorial-highlight"
          style={{
            left: box.left - 4,
            top: box.top - 4,
            width: box.width + 8,
            height: box.height + 8,
          }}
        />
      )}
      <div
        ref={chatRef}
        className={`tutorial-chat tutorial-chat--${position.placement}`}
        data-testid="tutorial-chat"
        style={{ left: position.left, top: position.top, width: CHAT_WIDTH }}
      >
        <div className="tutorial-chat-header">
          <img className="tutorial-chat-icon" src={runAgentIcon} alt="" aria-hidden="true" />
          <div>
            <div className="tutorial-chat-name">CodeChroma guide</div>
            <div className="tutorial-chat-stage" data-testid="tutorial-stage">
              Stage {step.stage} of {TUTORIAL_STAGES.length} · {TUTORIAL_STAGES[step.stage - 1]}
            </div>
          </div>
        </div>
        <StageProgress step={step} />
        <p className="tutorial-chat-text">{typed}</p>
        {step.advance === "next" && typed.length === step.text.length && (
          <button type="button" className="tutorial-chat-next" onClick={tutorialStore.next}>
            {step.nextLabel ?? "Next"}
          </button>
        )}
      </div>
    </>
  );
}
