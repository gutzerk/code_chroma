import { useEffect, useRef, useState } from "react";
import { useIsWorkspaceReadOnly } from "../agents/workspaceStore";
import { useEngineClient } from "../engine-client/EngineClientContext";
import {
  guardedClick,
  providerGate,
  useGroupAvailability,
} from "../llm-settings/useGroupAvailability";
import { useWikiGeneralStatus } from "../state/useWikiGeneralStatus";
import { useSkillOutput } from "../state/useSkillOutput";
import { SkillOutputFeed } from "./SkillOutputFeed";
import { tutorialSimStore, useTutorialSim } from "../tutorial/tutorialSim";
import { advanceTutorialFrom, useTutorialActive } from "../tutorial/tutorialStore";
import { estimateTimeRemaining, parseWikiGeneralProgress } from "./wikiGeneralProgress";

/**
 * "Architecture wiki not created yet" + Generate, a generating status line + Stop, or (once it
 * exists but a commit has landed since) a stale banner + Update.
 *
 * Same screen-fixed chrome contract as SidecarSummaryCard/DiagramHealthNote (outside
 * CanvasViewport, in RootCanvas), stacked a third row above them. Unlike those two, this mounts the
 * canvas's first real Generate button (docs/planning/047-wiki-general's research finding that no
 * live C1/Patterns "Retry" button exists today) -- built from useWikiGeneralStatus/useDiagramGeneration's
 * shared trigger/stop shape, not by reusing either component. The stale/Update branch is the canvas's
 * first actionable staleness affordance (see docs/architecture/wiki-general.md's "Staying current
 * after a commit") -- deliberately a click, never an automatic run.
 *
 * Hidden entirely for a read-only workspace (a PR checkout can't run either skill), once a valid,
 * non-stale wiki-general already exists, and for a repo with no real code yet (`status.empty`) --
 * in each case there is nothing left to ask the user for.
 */
export function WikiGeneralNotice() {
  const engineClient = useEngineClient();
  const isReadOnly = useIsWorkspaceReadOnly();
  const status = useWikiGeneralStatus(engineClient);
  // Same live progress feed C1/Patterns show while generating (bridge already exposes
  // GET/WS .../wiki-general/output -- see docs/architecture/wiki-general.md) -- lets the user see
  // which phase (plan / C3 fan-out / C2 fan-out / C1+manifest / self-check) is actually running,
  // instead of just a spinner, since a full run can take several minutes. The generate pipeline's
  // own "→ N/M" lines (058) additionally drive a real progress bar; an update run's plain-prose
  // lines don't match, so parseWikiGeneralProgress just falls back to the indeterminate sweep.
  const lines = useSkillOutput(engineClient, "wiki-general", status.state);
  const providerAvailable = useGroupAvailability("planning");

  const isGenerating = status.state === "generating";
  // null until the pipeline's first "→ N/M" line lands -- the bar stays indeterminate till then.
  const progress = isGenerating ? parseWikiGeneralProgress(lines) : null;
  // Start of the current run, for the ETA below -- reset to null between runs so a later run
  // doesn't extrapolate off a stale timestamp. A mount that reveals a run already in progress (not
  // one this tab started) has no real start time to recover, so the ETA is a slight underestimate
  // for that case until the rate has had time to settle.
  const startedAtRef = useRef<number | null>(null);
  useEffect(() => {
    startedAtRef.current = isGenerating ? Date.now() : null;
  }, [isGenerating]);
  const elapsedMs = startedAtRef.current !== null ? Date.now() - startedAtRef.current : 0;
  const eta = estimateTimeRemaining(progress, elapsedMs);
  const tutorialActive = useTutorialActive();
  const sim = useTutorialSim();
  const [showReady, setShowReady] = useState(false);
  const wasGeneratingRef = useRef(false);
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating && status.has_wiki_general) setShowReady(true);
    wasGeneratingRef.current = isGenerating;
  }, [isGenerating, status.has_wiki_general]);
  useEffect(() => {
    if (sim.wiki === "done") setShowReady(!sim.wikiAcked);
  }, [sim.wiki, sim.wikiAcked]);
  const readyNotice = showReady ? (
    <div
      className="wiki-general-notice wiki-ready-notice"
      role="status"
      data-testid="wiki-ready-notice"
    >
      <span>Architecture wiki is ready</span>
      <button
        type="button"
        className="wiki-ready-dismiss"
        data-testid="wiki-ready-dismiss"
        aria-label="Dismiss"
        onClick={() => setShowReady(false)}
      >
        ✓
      </button>
    </div>
  ) : null;
  // The tutorial swaps the real Generate for a simulation, so a lesson never calls a model.
  if (tutorialActive && sim.wiki !== "done") {
    return (
      <div className="wiki-general-notice" role="status" data-testid="wiki-general-notice">
        {sim.wiki === "running" ? (
          <>
            <span className="wiki-general-spinner" aria-hidden="true" />
            <div className="wiki-general-generating-body">
              <span>Building the architecture map…</span>
              <div className="wiki-general-progress" aria-hidden="true">
                <div
                  className="wiki-general-progress-bar wiki-general-progress-bar--determinate"
                  style={{ width: `${sim.wikiPercent}%` }}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <span>Architecture wiki not created yet</span>
            <button
              type="button"
              className="wiki-general-generate-button"
              data-testid="wiki-general-generate"
              onClick={() => tutorialSimStore.startWiki(() => advanceTutorialFrom("wiki-building"))}
            >
              Generate
            </button>
          </>
        )}
      </div>
    );
  }
  if (sim.wiki === "done") return readyNotice;
  const nothingToAsk = status.empty || (status.has_wiki_general && !status.stale);
  if (isReadOnly || (nothingToAsk && !isGenerating)) return readyNotice;

  // Shared by both Generate and Update -- aria-disabled (never native) keeps the hint keyboard-reachable.
  const gate = providerGate(providerAvailable);

  return (
    <>
      <div className="wiki-general-notice" role="status" data-testid="wiki-general-notice">
        {isGenerating ? (
          <>
            <span className="wiki-general-spinner" aria-hidden="true" />
            <div className="wiki-general-generating-body">
              <span>
                Building the architecture map…
                {progress ? ` ${progress.completed} / ${progress.total}` : ""}
                {eta ? ` (${eta})` : ""}
              </span>
              <div
                className="wiki-general-progress"
                role={progress ? "progressbar" : undefined}
                aria-hidden={progress ? undefined : true}
                aria-valuemin={progress ? 0 : undefined}
                aria-valuemax={progress?.total}
                aria-valuenow={progress?.completed}
                data-testid="wiki-general-progress"
              >
                <div
                  className={
                    progress
                      ? "wiki-general-progress-bar wiki-general-progress-bar--determinate"
                      : "wiki-general-progress-bar"
                  }
                  style={progress ? { width: `${progress.percent}%` } : undefined}
                />
              </div>
              <SkillOutputFeed lines={lines} testId="wiki-general-generation-output" />
            </div>
            <button
              type="button"
              className="generating-stop-button"
              data-testid="wiki-general-stop"
              onClick={status.stop}
            >
              Stop
            </button>
          </>
        ) : status.has_wiki_general ? (
          <>
            <span>
              Architecture wiki is outdated
              {status.state === "error" && status.error ? ` — ${status.error}` : ""}
            </span>
            <button
              type="button"
              className="wiki-general-update-button"
              data-testid="wiki-general-update"
              onClick={guardedClick(!providerAvailable, status.update)}
              {...gate}
            >
              Update
            </button>
          </>
        ) : (
          <>
            <span>
              Architecture wiki not created yet
              {status.state === "error" && status.error ? ` — ${status.error}` : ""}
            </span>
            <button
              type="button"
              className="wiki-general-generate-button"
              data-testid="wiki-general-generate"
              onClick={guardedClick(!providerAvailable, status.trigger)}
              {...gate}
            >
              Generate
            </button>
          </>
        )}
      </div>
      {readyNotice}
    </>
  );
}
