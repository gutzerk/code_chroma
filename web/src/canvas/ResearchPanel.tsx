import { useState, type FormEvent } from "react";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { useResearch } from "../state/useResearch";
import { inspectorStore } from "./inspectorStore";
import type { ResearchCitation } from "../state/types";

function citationLabel(citation: ResearchCitation): string {
  return citation.symbol ?? citation.path ?? citation.node_id;
}

/**
 * Ask-a-question panel: a plain text box, a synthesized answer, and a citation list that jumps
 * straight into the existing Inspector — deliberately not a canvas view (no dagre layout, no
 * per-node boxes), since the whole point is one short answer, not a diagram to browse.
 */
export function ResearchPanel({ hidden = false }: { hidden?: boolean }) {
  const client = useEngineClient();
  const { job, ask } = useResearch(client);
  const [query, setQuery] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    ask(trimmed);
  };

  const handleCitationClick = (citation: ResearchCitation) => {
    inspectorStore.open(citation.node_id, citationLabel(citation));
  };

  return (
    <aside
      className={`research-panel${hidden ? " research-panel-hidden" : ""}`}
      data-testid="research-panel"
      aria-label="Research"
    >
      <form className="research-panel-form" onSubmit={handleSubmit}>
        <input
          className="research-panel-input"
          type="text"
          placeholder="Ask a question about this codebase…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid="research-panel-input"
        />
        <button
          type="submit"
          className="research-panel-ask"
          disabled={job.state === "generating"}
          data-testid="research-panel-ask"
        >
          Ask
        </button>
      </form>
      {job.state === "generating" && <p className="research-panel-status">Thinking…</p>}
      {job.state === "error" && (
        <p className="research-panel-status research-panel-error">{job.error}</p>
      )}
      {job.answer && (
        <div className="research-panel-answer" data-testid="research-panel-answer">
          {job.answer.degraded && (
            <span className="research-panel-badge" data-testid="research-panel-degraded-badge">
              Keyword match — no AI provider configured
            </span>
          )}
          {job.answer.citations.length === 0 ? (
            <p className="research-panel-answer-text" data-testid="research-panel-no-match">
              {job.answer.answer}
            </p>
          ) : (
            <>
              <p className="research-panel-answer-text">{job.answer.answer}</p>
              <ul className="research-panel-citations">
                {job.answer.citations.map((citation, index) => (
                  <li key={citation.node_id}>
                    <button
                      type="button"
                      className="research-panel-citation"
                      data-testid={`research-panel-citation-${index}`}
                      onClick={() => handleCitationClick(citation)}
                    >
                      [{index + 1}] {citationLabel(citation)}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
