import { useEffect, useState, type ReactNode } from "react";
import type { EpicsDiagramClient } from "../../engine-client/epicsDiagramClient";
import type { EpicWorkItem } from "../../state/types";
import { epicBriefPanelStore } from "../doc/epicBriefPanelStore";
import { InspectorNote } from "../InspectorPanel";
import { joinNonEmpty } from "./brief/CopyBlockButton";
import { doneGlyph } from "./doneGlyph";
import { sectionHeader, sectionNodeId, stageHeader } from "./specStageHelpers";

interface Props {
  itemId: string;
  /** Shared panel-lifetime EpicsDiagramClient, so an already-fetched item is served from cache. */
  client: EpicsDiagramClient;
}

/** A headed inspector section (`Heading` + `ul` of one `li` per item); `renderItem` supplies the per-item body. */
function ListSection<T extends { id: string }>({
  heading,
  testId,
  items,
  renderItem,
}: {
  heading: string;
  testId: string;
  items: T[];
  renderItem: (item: T) => ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h4 className="inspector-work-item-heading">{heading}</h4>
      <ul className="inspector-work-item-list" data-testid={testId}>
        {items.map((item) => (
          <li key={item.id} className="inspector-work-item-listitem">
            {renderItem(item)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The inspector level for an epic/story box (010-epics-tree-render Part 5): a work item has no real
 * hierarchy `node_id`, so instead of a code tree it shows the item's full text — summary, acceptance
 * criteria, description (children/summary surface what the box's truncated label hides), and its
 * cross-epic links. The AI-brief button sits here too, so the brief stays reachable without making it
 * the box's primary click. Fetches through the panel's shared `client` so the same dedupe/cache rules
 * the epic view uses apply (one fetch per id, merged stages), surviving reads across drill changes.
 */
export function InspectorWorkItem({ itemId, client }: Props) {
  const [item, setItem] = useState<EpicWorkItem | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setItem(null);
    setError(undefined);
    client
      .fetchItem(itemId)
      .then((result) => {
        if (cancelled) return;
        if (result === null) {
          setError(`Work item ${itemId} no longer has a source file.`);
          return;
        }
        setItem(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, client]);

  if (error) {
    return <InspectorNote testId="inspector-work-item-error">{error}</InspectorNote>;
  }
  if (!item) {
    return <InspectorNote>Loading…</InspectorNote>;
  }

  const status = joinNonEmpty([item.status, item.priority, item.group], " · ");

  return (
    <div className="inspector-work-item" data-testid="inspector-work-item">
      <button
        type="button"
        className="inspector-code-button"
        data-testid="inspector-work-item-open-brief"
        onClick={() => epicBriefPanelStore.open(item.id)}
      >
        Open AI brief
      </button>
      {status && (
        <p className="inspector-work-item-status" data-testid="inspector-work-item-status">
          {status}
        </p>
      )}
      {item.summary && (
        <section>
          <h4 className="inspector-work-item-heading">Summary</h4>
          <p className="inspector-work-item-body" data-testid="inspector-work-item-summary">
            {item.summary}
          </p>
        </section>
      )}
      <ListSection
        heading="Acceptance criteria"
        testId="inspector-work-item-criteria"
        items={item.requirements}
        renderItem={(requirement) => requirement.text}
      />
      <ListSection
        heading="Children"
        testId="inspector-work-item-children"
        items={item.children}
        renderItem={(child) => (
          <>
            <button
              type="button"
              className="inspector-code-button"
              aria-label={`Open brief for ${child.id}`}
              onClick={() => epicBriefPanelStore.open(child.id)}
            >
              {child.id}
            </button>{" "}
            {child.title}
          </>
        )}
      />
      <ListSection
        heading="Links"
        testId="inspector-work-item-links"
        items={item.links}
        renderItem={(link) => (
          <>
            {link.relation} → {link.id}
          </>
        )}
      />
      {item.stages.length > 0 && (
        <section>
          <h4 className="inspector-work-item-heading">Specification</h4>
          <ul className="inspector-work-item-list" data-testid="inspector-work-item-stages">
            {item.stages.map((stage) => (
              <li key={`${stage.name}::${stage.kind}`} className="inspector-work-item-listitem">
                <span className="inspector-work-item-body">
                  <strong>{stageHeader(stage)}</strong> <code>{stage.name}</code>
                  {stage.sections.length > 0 && (
                    <ul className="inspector-work-item-nested">
                      {stage.sections.map((section, index) => (
                        <li key={sectionNodeId(stage.name, stage.kind, index)}>
                          {sectionHeader(section)}
                          {section.items.length > 0 && (
                            <ul className="inspector-work-item-nested">
                              {section.items.map((sectionItem) => (
                                <li key={sectionItem.id}>
                                  {doneGlyph(sectionItem.done)} {sectionItem.text}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!item.summary &&
        item.requirements.length === 0 &&
        item.children.length === 0 &&
        item.links.length === 0 &&
        item.stages.length === 0 && (
          <InspectorNote testId="inspector-work-item-empty">
            Nothing to show inside {item.id}.
          </InspectorNote>
        )}
    </div>
  );
}
