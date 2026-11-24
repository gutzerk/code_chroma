import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useAgentClient } from "../AgentClientContext";
import { useAgentModels } from "../agentModels";
import { PlusIcon } from "./icons";

/** How long "Run new agent" is held before the model menu drops down under it. */
export const LONG_PRESS_MS = 1000;

/** "Run new agent": a click runs the configured model; holding it for a second (or ArrowDown / right-click) lists models to pick for this one agent. */
export function RunAgentButton({ disabled, onRunAgent }: { disabled: boolean; onRunAgent: (model?: string) => void }) {
  const client = useAgentClient();
  const { choices, loading, error, refresh, supported } = useAgentModels(client);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const swallowClick = useRef(false);
  const focusFirst = useRef(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const cancelPress = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancelPress, []);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
  }, [open, choices]);

  const openMenu = (withFocus: boolean) => {
    if (disabled || !supported) return;
    focusFirst.current = withFocus;
    refresh();
    setOpen(true);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || !supported || e.button !== 0) return;
    swallowClick.current = false;
    cancelPress();
    // Prefetch now, so the list is usually there by the time the second is up.
    refresh();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      swallowClick.current = true;
      setOpen(true);
    }, LONG_PRESS_MS);
  };

  const onClick = () => {
    cancelPress();
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    setOpen(false);
    onRunAgent();
  };

  const onButtonKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    openMenu(true);
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const pick = (model?: string) => {
    setOpen(false);
    onRunAgent(model);
  };

  const current = choices?.current ?? null;
  const models = choices?.models ?? [];
  return (
    <span className="activity-run-wrap" ref={wrapRef}>
      <button
        type="button"
        className="activity-primary"
        aria-label="Run agent"
        title={supported ? "Run agent (hold to pick a model)" : "Run agent"}
        aria-haspopup={supported ? "menu" : undefined}
        aria-expanded={supported ? open : undefined}
        disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => {
          if (!supported) return;
          e.preventDefault();
          cancelPress();
          openMenu(false);
        }}
        onKeyDown={onButtonKeyDown}
        onClick={onClick}
      >
        <PlusIcon size={14} />
        Run new agent
      </button>
      {open && (
        <div className="run-agent-menu" role="menu" aria-label="Model for the new agent" ref={menuRef} onKeyDown={onMenuKeyDown}>
          <div className="run-agent-menu-head">
            Model for the new agent{choices?.provider_name ? ` · ${choices.provider_name}` : ""}
          </div>
          <button type="button" role="menuitem" className="run-agent-menu-item" onClick={() => pick()}>
            <span>Default</span>
            {current && <span className="run-agent-menu-id">{current}</span>}
          </button>
          {models.map((model) => (
            <button
              key={model.id}
              type="button"
              role="menuitem"
              className="run-agent-menu-item"
              aria-current={model.id === current ? "true" : undefined}
              onClick={() => pick(model.id)}
            >
              <span>{model.label ?? model.id}</span>
              {model.label && <span className="run-agent-menu-id">{model.id}</span>}
            </button>
          ))}
          {models.length === 0 && loading && <p className="run-agent-menu-note">Loading models…</p>}
          {models.length === 0 && !loading && error && <p className="run-agent-menu-note" role="alert">Could not list models: {error}</p>}
          {models.length === 0 && !loading && !error && choices && <p className="run-agent-menu-note">This connection does not list its models.</p>}
        </div>
      )}
    </span>
  );
}
