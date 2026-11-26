import { promptNavStore, usePromptNav } from "./promptNavStore";

/** The thin rail at the terminal's right edge: one mark per prompt, placed by its line in the buffer. */
export function PromptMarkers({ agentId }: { agentId: string }) {
  const { prompts, lines, totalLines, current, alternate } = usePromptNav(agentId);
  // The alternate buffer has no scrollback, so a prompt has no position to mark.
  if (alternate || prompts.length === 0 || totalLines === 0) return null;
  return (
    <div className="prompt-nav-markers" role="group" aria-label="Prompt map" data-testid={`prompt-markers-${agentId}`}>
      {prompts.map((p, i) => {
        const line = lines[i] ?? null;
        if (line === null) return null;
        return (
          <button
            key={p.id}
            type="button"
            tabIndex={-1}
            className="prompt-nav-marker"
            aria-label={`Jump to prompt ${p.index}`}
            aria-current={p.index === current || undefined}
            title={`#${p.index} ${p.text}`}
            style={{ top: `${(line / totalLines) * 100}%` }}
            onClick={() => promptNavStore.go(agentId, p.index)}
          >
            <span />
          </button>
        );
      })}
    </div>
  );
}
