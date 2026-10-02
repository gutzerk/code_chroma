import { useCallback, useEffect, useState } from "react";
import type { EpicsDiagramClient } from "../../../engine-client/epicsDiagramClient";
import type { EpicStage, EpicStageItem } from "../../../state/types";
import { doneGlyph } from "../doneGlyph";
import {
  sectionHeader,
  sectionNodeId,
  stageHeader,
  stageNodeId,
  toggleExpanded,
} from "../specStageHelpers";
import { CopyBlockButton, joinNonEmpty } from "./CopyBlockButton";

export interface SpecsFrameProps {
  itemId: string;
  client: EpicsDiagramClient;
}

/** A clickable "Specification (SpecKit)" frame reading the same `stages` the box-graph reads --
 * deterministic, no AI, sibling to the brief's own Problem/Scope/Dependencies/Acceptance content.
 * Renders nothing for a stage-less item (same no-placeholder rule the box-graph follows). Expanding
 * a stage's sections fetches through the shared `client` (dedupes/caches with the box-graph);
 * expanding a section needs no fetch, mirroring EpicsView's own toggleStage/toggleSection. */
export function SpecsFrame({ itemId, client }: SpecsFrameProps) {
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((value) => value + 1), []);
  const [expandedStageIds, setExpandedStageIds] = useState<ReadonlySet<string>>(new Set());
  const [expandedSectionIds, setExpandedSectionIds] = useState<ReadonlySet<string>>(new Set());

  // Populate the shared cache on mount -- without this the frame only renders stages the user
  // happened to fetch by expanding the item in the box-graph first. fetchItem is idempotent:
  // a cached or in-flight item resolves without a second network call.
  useEffect(() => {
    void client.fetchItem(itemId).then(() => bump());
  }, [itemId, client, bump]);

  const stages = client.getItem(itemId)?.stages ?? [];
  if (stages.length === 0) return null;

  const toggleStage = (stage: EpicStage) => {
    const nodeId = stageNodeId(stage.name, stage.kind);
    toggleExpanded(nodeId, expandedStageIds, setExpandedStageIds, () => {
      void client.fetchItem(itemId, nodeId).then(() => bump());
    });
  };

  const toggleSection = (secId: string) => {
    toggleExpanded(secId, expandedSectionIds, setExpandedSectionIds);
  };

  return (
    <div
      className="epic-brief-frame epic-brief-frame--specs"
      data-testid="epic-brief-specs-frame"
    >
      <div className="epic-brief-frame-label">Specification (SpecKit)</div>
      <div className="epic-brief-specs-row" data-testid="epic-brief-specs-row">
        {stages.map((stage) => {
          const nodeId = stageNodeId(stage.name, stage.kind);
          const isExpanded = expandedStageIds.has(nodeId);
          return (
            <div key={nodeId} className="epic-brief-specs-stage">
              <button
                type="button"
                className="epic-brief-specs-chip"
                data-testid="epic-brief-specs-stage-chip"
                onClick={() => toggleStage(stage)}
              >
                <span className="epic-brief-specs-chip-toggle">{isExpanded ? "▾" : "▸"}</span>
                {stageHeader(stage)}
              </button>
              {isExpanded && (
                <div className="epic-brief-specs-sections" data-testid="epic-brief-specs-sections">
                  {stage.sections.map((section, index) => {
                    const secId = sectionNodeId(stage.name, stage.kind, index);
                    const sectionExpanded = expandedSectionIds.has(secId);
                    return (
                      <div key={secId} className="epic-brief-specs-section">
                        <button
                          type="button"
                          className="epic-brief-specs-chip epic-brief-specs-chip--section"
                          data-testid="epic-brief-specs-section-chip"
                          onClick={() => toggleSection(secId)}
                        >
                          <span className="epic-brief-specs-chip-toggle">
                            {sectionExpanded ? "▾" : "▸"}
                          </span>
                          {sectionHeader(section)}
                        </button>
                        {sectionExpanded && (
                          <ul
                            className="epic-brief-specs-items"
                            data-testid="epic-brief-specs-items"
                          >
                            {section.items.map((item) => (
                              <li
                                key={item.id}
                                className="epic-brief-specs-item"
                                data-testid="epic-brief-specs-item"
                              >
                                <CopyBlockButton text={specItemText(item)} />
                                <span className="epic-stage-item-glyph">
                                  {doneGlyph(item.done)}
                                </span>
                                {item.parallel && (
                                  <span
                                    className="epic-brief-task-pflag"
                                    data-testid="epic-brief-specs-item-parallel"
                                  >
                                    [P]
                                  </span>
                                )}
                                {item.story && (
                                  <span
                                    className="epic-stage-item-story"
                                    data-testid="epic-brief-specs-item-story"
                                  >
                                    {item.story}
                                  </span>
                                )}
                                <span className="epic-stage-item-text">{item.text}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Joins a spec item's rendered pieces into the exact clipboard text, in display order: the
 * `[P]` marker, the story line, then the item text -- the same lines a user reads in the chip. */
function specItemText(item: EpicStageItem): string {
  return joinNonEmpty([item.parallel ? "[P]" : null, item.story ?? null, item.text], "\n");
}
