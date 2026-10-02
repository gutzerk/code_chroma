import { useEffect, useRef } from "react";

/** Within this many pixels of the bottom still counts as "following the stream". */
const STICK_THRESHOLD = 24;

export interface SkillOutputFeedProps {
  /** Rendered progress lines, oldest first, from useSkillOutput. */
  lines: string[];
  testId?: string;
}

/** What the headless `claude -p` run is doing, live — a read-only log, never an input surface.
 *
 * Deliberately not an xterm: the bridge sends plain rendered lines with no ANSI, so the terminal
 * stack (useXtermSession) would add a WebGL renderer and a writable stdin for no gain — and it
 * unconditionally wires term.onData and resizes its session, both wrong for a passive viewer.
 *
 * 🔴 The wheel listener is native and non-passive on purpose. This panel lives inside
 * .canvas-content, and CanvasViewport binds its zoom handler natively on .canvas-viewport (see the
 * comment there); a React onWheel is delegated from the root and would fire too late to stop it, so
 * scrolling the log would zoom the canvas instead. */
export function SkillOutputFeed({ lines, testId = "skill-output-feed" }: SkillOutputFeedProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stuckToBottom = useRef(true);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => event.stopPropagation();
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  // Follows the stream, but yields the moment the user scrolls back to read something.
  useEffect(() => {
    const element = scrollRef.current;
    if (element && stuckToBottom.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    stuckToBottom.current = distance <= STICK_THRESHOLD;
  };

  return (
    <div
      className="skill-output-feed"
      data-testid={testId}
      ref={scrollRef}
      onScroll={onScroll}
      aria-live="off"
    >
      {lines.length === 0 ? (
        <div className="skill-output-line skill-output-line--muted">
          … waiting for agent output
        </div>
      ) : (
        lines.map((line, index) => (
          <div className="skill-output-line" key={`${index}-${line}`}>
            {line}
          </div>
        ))
      )}
    </div>
  );
}
