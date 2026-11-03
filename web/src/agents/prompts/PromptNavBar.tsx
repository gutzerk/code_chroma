import { useCallback, useEffect, useState } from "react";
import { useDisclosureMenu } from "../../util/useDisclosureMenu";
import { PROMPT_KEYS, useOnRequest } from "./promptKeys";
import { ChevronDownIcon, ChevronUpIcon, UserIcon } from "../activity/icons";
import { PromptPicker } from "./PromptPicker";
import { promptNavStore, usePromptNav } from "./promptNavStore";
import "./PromptNav.css";

const STEPS = [
  { delta: -1, label: "Previous prompt", short: "Prev", keys: PROMPT_KEYS.prev, Icon: ChevronUpIcon },
  { delta: 1, label: "Next prompt", short: "Next", keys: PROMPT_KEYS.next, Icon: ChevronDownIcon },
] as const;

/** The row between the agent header and its terminal: compact (with a prompt list popover) or full screen. */
export function PromptNavBar({ agentId, full }: { agentId: string; full: boolean }) {
  const { prompts, lines, current, announce, findRequest } = usePromptNav(agentId);
  const [open, setOpen] = useState(false);
  const hide = useCallback(() => setOpen(false), []);
  const { containerRef, triggerRef } = useDisclosureMenu(open, hide);
  const total = prompts.length;
  const prompt = prompts[current - 1];

  useOnRequest(findRequest, () => {
    if (!full) setOpen(true);
  });
  useEffect(() => {
    if (full) setOpen(false);
  }, [full]);

  if (total === 0 || !prompt) return null;
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const count = (
    <span className="prompt-nav-count">
      {current} / {total}
    </span>
  );

  return (
    <div
      className="prompt-nav-bar"
      data-variant={full ? "full" : "compact"}
      data-testid={`prompt-nav-${agentId}`}
      ref={containerRef}
    >
      {full ? (
        <>
          <span className="prompt-nav-num">#{current}</span>
          <span className="prompt-nav-text" title={prompt.text}>
            {prompt.text}
          </span>
          <span className="prompt-nav-keys" aria-hidden="true">
            <kbd>{PROMPT_KEYS.alt}</kbd>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
          </span>
          {count}
        </>
      ) : (
        <>
          <span className="prompt-nav-user">
            <UserIcon size={14} />
          </span>
          <button
            ref={triggerRef}
            type="button"
            className="prompt-nav-current"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`Prompt ${current} of ${total}: ${prompt.text}. All my prompts`}
            title={`${prompt.text}\n\nAll my prompts (${PROMPT_KEYS.find})`}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="prompt-nav-text">{prompt.text}</span>
            {count}
            <ChevronDownIcon size={14} />
          </button>
        </>
      )}
      {STEPS.map(({ delta, label, short, keys, Icon }) => (
        <button
          key={delta}
          type="button"
          className="prompt-nav-step"
          aria-label={label}
          title={`${label} (${keys})`}
          disabled={delta < 0 ? current <= 1 : current >= total}
          onClick={() => promptNavStore.step(agentId, delta)}
        >
          <Icon size={16} />
          {full && <span>{short}</span>}
        </button>
      ))}
      {full && (
        <button type="button" className="prompt-nav-latest" onClick={() => promptNavStore.latest(agentId)}>
          Latest
        </button>
      )}
      {open && (
        <div className="prompt-nav-popover" data-testid={`prompt-nav-popover-${agentId}`}>
          <PromptPicker
            prompts={prompts}
            lines={lines}
            current={current}
            variant="popover"
            autoFocus
            onEscape={close}
            onPick={(index) => {
              promptNavStore.go(agentId, index);
              close();
            }}
          />
          <div className="prompt-nav-hint">
            <span>
              {PROMPT_KEYS.prev} {PROMPT_KEYS.next} prev / next
            </span>
            <span>↵ jump</span>
            <span>Esc close</span>
          </div>
        </div>
      )}
      <span className="visually-hidden" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
