import { useCallback, useRef, useState, type ComponentType } from "react";
import { RailButton } from "../canvas/RailButton";
import { RailIcon } from "../icons/RailIcon";
import { useDisclosureMenu } from "../util/useDisclosureMenu";
import { GameWindow } from "./GameWindow";
import { SnakeGame } from "./snake/SnakeGame";

interface GameEntry {
  id: string;
  label: string;
  Component: ComponentType<{
    active: boolean;
    snapshot?: unknown;
    onSnapshotChange?: (snapshot: unknown) => void;
  }>;
}

/** Every playable game, listed once so a new one is just a new entry here. */
const GAMES: GameEntry[] = [{ id: "snake", label: "Snake", Component: SnakeGame }];

/** The top bar's "Games" control: its own button (next to PrRailButton/SettingsRailButton),
 * opening a dropdown of games (just Snake for now) that each launch in their own GameWindow.
 * Nothing is persisted between separate openings — this is for a short break, not app state —
 * but minimizing keeps the same session alive: the button stays pressed to say a game is still
 * running, and clicking it again restores the window instead of reopening the dropdown. */
export function GamesMenu() {
  const [open, setOpen] = useState(false);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const { containerRef, triggerRef, onListKeyDown } = useDisclosureMenu(open, () => setOpen(false));

  // GameWindow remounts its game every minimize/restore (see SnakeGame's comment), so this ref is
  // what actually survives that remount: each game writes its latest state here on every change,
  // and reads it back as its initial state next time it mounts. Cleared on pick/dismiss so a new
  // or reopened-from-closed game never inherits a stale snapshot.
  const snapshotRef = useRef<unknown>(null);
  const onSnapshotChange = useCallback((snapshot: unknown) => {
    snapshotRef.current = snapshot;
  }, []);

  const activeGame = GAMES.find((game) => game.id === activeGameId) ?? null;
  const ActiveGame = activeGame?.Component;
  const running = activeGame !== null;

  const onTriggerClick = () => {
    if (running && minimized) {
      setMinimized(false);
      return;
    }
    setOpen((current) => !current);
  };

  const pick = (id: string) => {
    setOpen(false);
    setMinimized(false);
    snapshotRef.current = null;
    setActiveGameId(id);
  };

  return (
    <div className="games-menu" ref={containerRef}>
      <RailButton
        ref={triggerRef}
        label={running && minimized ? `${activeGame.label} minimized — click to restore` : "Games"}
        className="games-menu-button"
        testId="games-menu-button"
        ariaExpanded={open}
        pressed={open || running}
        onClick={onTriggerClick}
      >
        <RailIcon name="games" />
      </RailButton>
      {open && (
        <ul className="games-menu-list" data-testid="games-menu-list" onKeyDown={onListKeyDown}>
          {GAMES.map((game) => (
            <li key={game.id}>
              <button
                type="button"
                className="games-menu-item"
                data-testid={`games-menu-item-${game.id}`}
                onClick={() => pick(game.id)}
              >
                {game.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {ActiveGame && activeGame && (
        <GameWindow
          title={activeGame.label}
          minimized={minimized}
          onMinimize={() => setMinimized(true)}
          onDismiss={() => {
            snapshotRef.current = null;
            setActiveGameId(null);
          }}
        >
          <ActiveGame
            active={!minimized}
            snapshot={snapshotRef.current}
            onSnapshotChange={onSnapshotChange}
          />
        </GameWindow>
      )}
    </div>
  );
}
