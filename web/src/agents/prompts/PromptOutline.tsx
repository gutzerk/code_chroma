import { useRef } from "react";
import { PromptPicker } from "./PromptPicker";
import { PROMPT_KEYS, useOnRequest } from "./promptKeys";
import { promptNavStore, usePromptNav } from "./promptNavStore";
import { PROMPT_NAV_SCOPE } from "./usePromptHotkeys";

/** Full screen's left-column section under the agent list: every prompt of the selected agent, searchable. */
export function PromptOutline({ agentId, agentTitle }: { agentId: string; agentTitle: string }) {
  const { prompts, lines, current, findRequest } = usePromptNav(agentId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useOnRequest(findRequest, () => inputRef.current?.focus());

  if (prompts.length === 0) return null;
  return (
    <section
      className="prompt-outline"
      aria-label="Your prompts"
      data-testid={`prompt-outline-${agentId}`}
      {...{ [PROMPT_NAV_SCOPE]: agentId }}
    >
      <div className="prompt-outline-heading">Your prompts · {prompts.length}</div>
      <div className="prompt-outline-sub">in {agentTitle}</div>
      <PromptPicker
        key={agentId}
        prompts={prompts}
        lines={lines}
        current={current}
        variant="outline"
        inputRef={inputRef}
        onPick={(index) => promptNavStore.go(agentId, index)}
      />
      <div className="prompt-nav-hint">
        <span>
          {PROMPT_KEYS.alt}↑↓ prev / next
        </span>
        <span>{PROMPT_KEYS.find} find</span>
      </div>
    </section>
  );
}
