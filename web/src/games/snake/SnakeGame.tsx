import { useCallback, useEffect, useRef, useState } from "react";
import { createInitialState, GRID_SIZE, step, TICK_MS, type Direction, type SnakeState } from "./snakeLogic";

const CELL_PX = 16;

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function draw(canvas: HTMLCanvasElement, state: SnakeState) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#1b1f24";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#4ade80";
  for (const cell of state.body) {
    ctx.fillRect(cell.x * CELL_PX, cell.y * CELL_PX, CELL_PX - 1, CELL_PX - 1);
  }
  ctx.fillStyle = "#f87171";
  ctx.fillRect(state.food.x * CELL_PX, state.food.y * CELL_PX, CELL_PX - 1, CELL_PX - 1);
}

interface SnakeSnapshot {
  state: SnakeState;
  paused: boolean;
}

function isSnakeSnapshot(value: unknown): value is SnakeSnapshot {
  return typeof value === "object" && value !== null && "state" in value && "paused" in value;
}

/** The Snake game itself: a canvas grid driven by a setInterval tick and arrow-key input, with
 * every rule (movement, collision, food, score) delegated to snakeLogic's pure step() so the
 * component is just wiring. GameWindow actually remounts this component every time it minimizes
 * or restores (its wrapper switches between a plain div and ModalDialog), so nothing here truly
 * "keeps running in the background" -- `snapshot`/`onSnapshotChange` fake persistence instead: the
 * caller (GamesMenu) hands back whatever snapshot it was last given as the lazy initial state, so
 * score/position/pause survive the remount. No progress is kept once GameWindow closes it, since
 * GamesMenu drops its snapshot on close. Keyboard input is separately gated on `active` (the
 * window isn't visible while minimized, so arrows/space shouldn't react to a hidden canvas). */
export function SnakeGame({
  active,
  snapshot,
  onSnapshotChange,
}: {
  active: boolean;
  snapshot?: unknown;
  onSnapshotChange?: (snapshot: unknown) => void;
}) {
  const restored = isSnakeSnapshot(snapshot) ? snapshot : null;
  const [state, setState] = useState<SnakeState>(() => restored?.state ?? createInitialState());
  const [paused, setPaused] = useState(() => restored?.paused ?? false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestedDirectionRef = useRef<Direction>(state.direction);

  useEffect(() => {
    if (canvasRef.current) draw(canvasRef.current, state);
  }, [state]);

  useEffect(() => {
    onSnapshotChange?.({ state, paused });
  }, [state, paused, onSnapshotChange]);

  const restart = useCallback(() => {
    const fresh = createInitialState();
    requestedDirectionRef.current = fresh.direction;
    setPaused(false);
    setState(fresh);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!active) return;
      if (event.key === "Enter" && state.gameOver) {
        event.preventDefault();
        restart();
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        setPaused((current) => (state.gameOver ? current : !current));
        return;
      }
      const next = KEY_TO_DIRECTION[event.key];
      if (!next) return;
      event.preventDefault();
      requestedDirectionRef.current = next;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, state.gameOver, restart]);

  useEffect(() => {
    if (state.gameOver || paused) return;
    const id = window.setInterval(() => {
      setState((current) => step(current, requestedDirectionRef.current));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [state.gameOver, paused]);

  return (
    <div className="snake-game">
      <div className="snake-game-score" data-testid="snake-score">
        Score: {state.score}
      </div>
      <canvas
        ref={canvasRef}
        className="snake-game-canvas"
        width={GRID_SIZE * CELL_PX}
        height={GRID_SIZE * CELL_PX}
        data-testid="snake-canvas"
      />
      {paused && !state.gameOver && (
        <div className="snake-game-paused" data-testid="snake-paused">
          <p>Paused — press space to resume</p>
        </div>
      )}
      {state.gameOver && (
        <div className="snake-game-over" data-testid="snake-game-over">
          <p>Game over</p>
          <button type="button" className="snake-restart" data-testid="snake-restart" onClick={restart}>
            Play again
          </button>
        </div>
      )}
    </div>
  );
}
