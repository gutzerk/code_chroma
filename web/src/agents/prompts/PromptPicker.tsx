import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { SearchIcon } from "../activity/icons";
import { filterPrompts, formatTime, type PromptItem } from "./promptNav";

const OFFSCREEN_NOTE = "No longer in the terminal history";

/** The search box and prompt listbox shared by the compact popover and the full-screen outline. */
export function PromptPicker({
  prompts,
  lines,
  current,
  onPick,
  onEscape,
  variant,
  inputRef,
  autoFocus = false,
}: {
  prompts: PromptItem[];
  lines: (number | null)[];
  current: number;
  onPick: (index: number) => void;
  /** Esc in the search box; the outline clears the query instead when this is absent. */
  onEscape?: () => void;
  variant: "popover" | "outline";
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterPrompts(prompts, query), [prompts, query]);
  const [cursor, setCursor] = useState(() => Math.max(0, visible.findIndex((p) => p.index === current)));
  const listRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const optionId = (index: number) => `${id}-prompt-${index}`;
  const cursorItem = visible[Math.min(cursor, visible.length - 1)];

  useEffect(() => {
    if (variant !== "outline" || current === 0) return;
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [variant, current]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const last = visible.length - 1;
      setCursor((c) => Math.max(0, Math.min(Math.min(c, last) + delta, last)));
    } else if (event.key === "Enter" && cursorItem) {
      event.preventDefault();
      onPick(cursorItem.index);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (onEscape) onEscape();
      else setQuery("");
    }
  };

  return (
    <>
      <label className="prompt-nav-search">
        <SearchIcon size={14} />
        <span className="visually-hidden">Find in my prompts</span>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={cursorItem ? optionId(cursorItem.index) : undefined}
          aria-autocomplete="list"
          placeholder="Find in my prompts"
          value={query}
          autoFocus={autoFocus}
          data-prompt-search=""
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      <div
        className="prompt-nav-options"
        id={`${id}-list`}
        role="listbox"
        aria-label="My prompts"
        ref={listRef}
      >
        {visible.map((p) => {
          const offscreen = (lines[p.index - 1] ?? null) === null;
          const time = formatTime(p.createdAt);
          return (
            <button
              key={p.id}
              id={optionId(p.index)}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={p.index === current}
              className="prompt-nav-option"
              data-index={p.index}
              data-cursor={p === cursorItem || undefined}
              data-offscreen={offscreen || undefined}
              title={offscreen ? `${p.text}\n\n${OFFSCREEN_NOTE}` : p.text}
              onClick={() => onPick(p.index)}
            >
              <span className="prompt-nav-option-num">#{p.index}</span>
              <span className="prompt-nav-option-body">
                <span className="prompt-nav-option-text">{p.text}</span>
                {variant === "outline" && (
                  <span className="prompt-nav-option-meta">{[time, p.summary].filter(Boolean).join(" · ")}</span>
                )}
              </span>
              {variant === "popover" && time && <span className="prompt-nav-option-time">{time}</span>}
            </button>
          );
        })}
      </div>
      {visible.length === 0 && <div className="prompt-nav-empty">No prompts match</div>}
    </>
  );
}
