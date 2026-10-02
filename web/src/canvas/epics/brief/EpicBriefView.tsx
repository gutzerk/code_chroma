import { useMemo } from "react";
import { useEngineClient } from "../../../engine-client/EngineClientContext";
import {
  guardedClick,
  providerGate,
  useGroupAvailability,
} from "../../../llm-settings/useGroupAvailability";
import { useEpicBrief } from "../../../state/useEpicBrief";
import type { EpicScopeItem } from "../../../state/types";
import type { EpicsDiagramClient } from "../../../engine-client/epicsDiagramClient";
import { DiagramGeneratingPanel, DiagramStatusPanel } from "../../DiagramSurface";
import { AcceptanceCriterionBlock } from "./AcceptanceCriterionBlock";
import { colorForScopeIndex, DEFAULT_SCOPE_COLOR, ScopeItemCard } from "./ScopeItemCard";
import { SpecsFrame } from "./SpecsFrame";
import { TaskChip } from "./TaskChip";
import { CopyBlockButton, joinNonEmpty } from "./CopyBlockButton";
import type { BriefTask } from "../../../state/types";

export interface EpicBriefViewProps {
  itemId: string;
  /** The one EpicsDiagramClient EpicBriefPanel builds -- its fetchItem/getItem cache is what makes
   * reopening an already-fetched item free. */
  client: EpicsDiagramClient;
}

/** The AI-brief document for one epic: problem/value, scope (cards in a row, each card's tasks in
 * a column inside it), dependencies & risks, acceptance criteria -- a plain scrollable DOM flow,
 * not a dagre graph (Decisions: the content is inherently nested, not independently-positioned
 * boxes needing drag/pan). */
export function EpicBriefView({ itemId, client }: EpicBriefViewProps) {
  const engineClient = useEngineClient();
  const { job, generate, stop, outputLines, loaded } = useEpicBrief(engineClient, itemId);
  const isGenerating = job.state === "generating";
  const brief = job.brief;
  const providerAvailable = useGroupAvailability("planning");

  const grouping = useMemo(() => {
    const scopeColors = new Map<string, string>();
    const inScope: EpicScopeItem[] = [];
    const outOfScope: EpicScopeItem[] = [];
    const testingTasks: BriefTask[] = [];
    for (const item of brief?.scope ?? []) {
      if (item.in_scope) {
        scopeColors.set(item.id, colorForScopeIndex(inScope.length));
        inScope.push(item);
        for (const task of item.tasks) {
          if (task.is_test) testingTasks.push(task);
        }
      } else {
        outOfScope.push(item);
      }
    }
    const scopeById = new Map((brief?.scope ?? []).map((item) => [item.id, item]));
    return { scopeColors, inScope, outOfScope, testingTasks, scopeById };
  }, [brief]);

  if (isGenerating) {
    return (
      <DiagramGeneratingPanel kind="epic-brief" lines={outputLines} onStop={stop}>
        Generating the AI brief…
      </DiagramGeneratingPanel>
    );
  }

  if (!brief) {
    return (
      <div className="epic-brief-view" data-testid="epic-brief-view">
        {/* Gated on `loaded`: until the first GET answers, `brief` is indistinguishable from
         * "confirmed no brief" -- showing Generate here before that would flash it over a brief
         * that's actually about to load. */}
        {loaded && (
          <DiagramStatusPanel kind="epic-brief">
            <p className="epic-brief-empty-copy">No AI brief generated for this epic yet.</p>
            {job.error && <div className="epic-brief-generation-error">{job.error}</div>}
            <button
              type="button"
              className="epic-brief-generate-button"
              data-testid="epic-brief-generate-button"
              {...providerGate(providerAvailable)}
              onClick={guardedClick(!providerAvailable, () => generate())}
            >
              Generate
            </button>
          </DiagramStatusPanel>
        )}
        {/* Deterministic, no AI -- shows up even before a brief has ever been generated. */}
        <SpecsFrame itemId={itemId} client={client} />
      </div>
    );
  }

  const { scopeColors, inScope, outOfScope, testingTasks, scopeById } = grouping;

  return (
    <div className="epic-brief-view" data-testid="epic-brief-view">
      <div
        className="epic-brief-frame epic-brief-frame--problem"
        data-testid="epic-brief-problem-frame"
      >
        <div className="epic-brief-frame-label">Problem / Value</div>
        <button
          type="button"
          className="epic-brief-regenerate-button"
          data-testid="epic-brief-regenerate-button"
          {...providerGate(providerAvailable)}
          onClick={guardedClick(!providerAvailable, () => generate(true))}
        >
          Regenerate
        </button>
        {job.error && (
          <div
            className="epic-brief-generation-error"
            data-testid="epic-brief-regenerate-error"
            role="alert"
          >
            {job.error}
          </div>
        )}
        <div className="epic-brief-row">
          {brief.problem.map((line, index) => (
            <p key={index} className="epic-brief-block">
              <CopyBlockButton text={line} />
              {line}
            </p>
          ))}
        </div>
      </div>

      {brief.spokes.length > 0 && (
        <div
          className={`epic-brief-frame epic-brief-frame--spokes${
            brief.spokes.length < 10 ? " epic-brief-frame--spokes-wide" : ""
          }`}
          data-testid="epic-brief-spokes-frame"
        >
          <div className="epic-brief-frame-label">
            {brief.component ? `Spokes / parts — ${brief.component}` : "Spokes / parts"}
          </div>
          {/* Fewer than 10 spokes: keep each block at natural width instead of shrinking
               them to fit -- widen the whole zone instead. */}
          <div
            className={`epic-brief-row epic-brief-row--spokes${
              brief.spokes.length < 10 ? " epic-brief-row--spokes-wide" : ""
            }`}
          >
            {brief.spokes.map((spoke, index) => (
              <div key={index} className="epic-brief-block">
                <CopyBlockButton text={`${spoke.spoke}: ${spoke.role}`} />
                <b>{spoke.spoke}</b>
                {spoke.role}
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className="epic-brief-frame epic-brief-frame--scope"
        data-testid="epic-brief-scope-frame"
      >
        <div className="epic-brief-frame-label">Scope</div>
        {brief.prep_tasks.length > 0 && (
          <div className="epic-brief-prep-strip" data-testid="epic-brief-prep-strip">
            <b>Prep (not tied to one scope item):</b>
            {brief.prep_tasks.map((task) => (
              <TaskChip key={task.id} task={task} />
            ))}
          </div>
        )}
        <div className="epic-brief-scope-stack" data-testid="epic-brief-scope-stack">
          {inScope.map((item) => (
            <ScopeItemCard key={item.id} item={item} color={scopeColors.get(item.id)} />
          ))}
        </div>
        {/* The pooled "Testing" subgroup: every is_test task from across the scope, in one labeled
         * block under the feature cards -- test work gets its own home instead of mixing into the
         * cards, while still being attributed to no single feature scope item. */}
        {testingTasks.length > 0 && (
          <>
            <div className="epic-brief-subgroup-label epic-brief-subgroup-label--testing">
              Testing
            </div>
            <div className="epic-brief-testing-row" data-testid="epic-brief-testing-row">
              {testingTasks.map((task) => (
                <TaskChip key={task.id} task={task} />
              ))}
            </div>
          </>
        )}
        {outOfScope.length > 0 && (
          <>
            <div className="epic-brief-subgroup-label epic-brief-subgroup-label--out">
              Out of scope — no tasks
            </div>
            <div className="epic-brief-out-row" data-testid="epic-brief-out-row">
              {outOfScope.map((item) => (
                <ScopeItemCard key={item.id} item={item} />
              ))}
            </div>
          </>
        )}
      </div>

      <SpecsFrame itemId={itemId} client={client} />

      <div className="epic-brief-frame epic-brief-frame--deps" data-testid="epic-brief-deps-frame">
        <div className="epic-brief-frame-label">Dependencies &amp; risks</div>
        <div className="epic-brief-row">
          {brief.dependencies.map((dependency, index) => (
            <div key={index} className="epic-brief-block">
              <CopyBlockButton text={blockText([dependencyLabel(dependency.kind), dependency.text, dependency.ids.join(", ")])} />
              <b>{dependencyLabel(dependency.kind)}</b>
              {dependency.text}
              {dependency.ids.length > 0 && (
                <span className="epic-brief-tag">{dependency.ids.join(", ")}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div
        className="epic-brief-frame epic-brief-frame--acceptance"
        data-testid="epic-brief-acceptance-frame"
      >
        <div className="epic-brief-frame-label">Acceptance criteria</div>
        <div className="epic-brief-row">
          {brief.acceptance.map((criterion) => {
            const closingItem = criterion.closes_scope_id
              ? scopeById.get(criterion.closes_scope_id)
              : null;
            const closingScope = closingItem
              ? {
                  title: closingItem.title,
                  color: scopeColors.get(closingItem.id) ?? DEFAULT_SCOPE_COLOR,
                }
              : null;
            return (
              <AcceptanceCriterionBlock
                key={criterion.id}
                criterion={criterion}
                closingScope={closingScope}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function dependencyLabel(kind: string): string {
  if (kind === "depends_on") return "Depends on";
  if (kind === "enables") return "Enables";
  if (kind === "risk") return "Risk";
  if (kind === "check") return "Extra check";
  return kind;
}

/** Joins a block's non-empty lines into the exact clipboard text shown inside the block. */
function blockText(parts: Array<string | null | undefined>): string {
  return joinNonEmpty(parts, "\n");
}
