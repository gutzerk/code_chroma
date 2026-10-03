import { useEffect, useState, type ReactNode } from "react";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { CanvasElement } from "../../state/types";
import { renderHighlighted } from "../highlighting/renderHighlighted";
import { stringMeta } from "./elementMeta";
import { isContentCard, isPhaseSpec, parentKeyOf } from "./epicsLayout";

const KIND_LABEL: Record<string, string> = {
  epic: "Epic",
  spec: "Phase / spec",
  task: "Task",
};

/** Siblings under the same parent key, for showing a phase's tasks or an epic's children. */
function findChildren(doc: { elements: Record<string, CanvasElement> }, parentKey: string): CanvasElement[] {
  return Object.values(doc.elements)
    .filter((e) => parentKeyOf(stringMeta(e, "recipe_key") ?? "") === parentKey)
    .sort((a, b) =>
      (stringMeta(a, "recipe_key") ?? a.id).localeCompare(stringMeta(b, "recipe_key") ?? b.id),
    );
}

/** Reads `element.meta[key]` as a finite positive integer line number, else undefined. */
function numberMeta(element: CanvasElement, key: string): number | undefined {
  const raw = element.meta[key];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.round(raw);
}

/** A slice of a linked source file, fetched by repo path + optional line range and rendered with
 * the same highlighter the code inspector uses. The epic's own scribe stamps `meta.source_ref`
 * (and, for a task whose text is a subset of the file, `meta.line_start`/`meta.line_end`); several
 * distinct boxes may share one file, each highlighting its own slice. */
function BlockSource({
  client,
  sourcePath,
  start,
  end,
}: {
  client: EngineClient;
  sourcePath: string;
  start?: number;
  end?: number;
}) {
  const [fragment, setFragment] = useState<{ content: string; language: string | null } | null>(null);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (!client.getSourceFragment) return;
    let alive = true;
    setFragment(null);
    setError(false);
    client
      .getSourceFragment(sourcePath, start != null || end != null ? { start, end } : undefined)
      .then((res) => {
        if (alive) setFragment(res);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [client, sourcePath, start, end]);

  if (error) {
    return <p className="inspector-work-item-body">Couldn’t read the linked file.</p>;
  }
  if (!fragment) {
    return <p className="inspector-work-item-body">Loading…</p>;
  }
  const lines = fragment.content.replace(/\n$/, "").split("\n");
  return (
    <pre className="block-code-view-source" data-testid="epic-block-panel-source">
      {lines.map((line, i) => (
        <span
          key={i}
          className={
            "epic-source-line" + (start != null || end != null ? " epic-source-line--in-range" : "")
          }
        >
          {renderHighlighted(line, fragment.language ?? undefined)}
        </span>
      ))}
    </pre>
  );
}

/** A compact nested row of one box, so the hierarchy reads at a glance. */
function NestRow({ title, children }: { title: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <section>
      <h4 className="inspector-work-item-heading">{title}</h4>
      <ul className="inspector-work-item-list">{children}</ul>
    </section>
  );
}

/** The inspector-level body for an epics-layer box that isn't itself a resolvable work item — a
 * task, phase header or content card. Shows the block's full text and its place in the epic. Rendered
 * inside the shared InspectorPanel, so the panel chrome (header/close/resize) is the same as code. */
export function EpicBlockContent({
  element,
  doc,
  client,
}: {
  element: CanvasElement;
  doc: { elements: Record<string, CanvasElement> };
  client?: EngineClient;
}) {
  const recipeKey = stringMeta(element, "recipe_key") ?? element.id;
  const kindLabel = KIND_LABEL[element.render] ?? element.render;
  const isCard = isContentCard(element);
  // A phase header (render "spec", key …::phase-N) -> its tasks; an epic box -> its top-level children.
  const isPhaseHeader = isPhaseSpec(element.render, recipeKey);
  const showChildren = isPhaseHeader || element.render === "epic";
  const childList = showChildren ? findChildren(doc, recipeKey) : [];
  const sourceRef = stringMeta(element, "source_ref");
  const lineStart = numberMeta(element, "line_start");
  const lineEnd = numberMeta(element, "line_end");
  // A task box shows only its linked source line(s) — its label already carries the task text, and
  // the source fragment is the concrete detail worth showing.
  const isTask = element.render === "task";

  return (
    <div className="inspector-work-item" data-testid="epic-block-panel">
      {!isTask ? (
        <p className="inspector-work-item-status" data-testid="epic-block-panel-kind">
          {kindLabel}
          {isCard ? " · content card" : ""}
          {element.render === "task" && stringMeta(element, "phase")
            ? ` · phase ${stringMeta(element, "phase")}`
            : ""}
        </p>
      ) : null}
      {!isTask && element.description ? (
        <section>
          <h4 className="inspector-work-item-heading">Description</h4>
          <p className="inspector-work-item-body" data-testid="epic-block-panel-description">
            {element.description}
          </p>
        </section>
      ) : null}

      {sourceRef && client ? (
        <section>
          <h4 className="inspector-work-item-heading">Linked file</h4>
          <BlockSource client={client} sourcePath={sourceRef} start={lineStart} end={lineEnd} />
        </section>
      ) : null}

      {showChildren && childList.length > 0 && (
        <NestRow title={isPhaseHeader ? "Tasks" : "Children"}>
          {childList.map((child) => (
            <li key={child.id} className="inspector-work-item-listitem">
              <span className="inspector-work-item-body">
                <strong>{KIND_LABEL[child.render] ?? child.render}</strong> ·{" "}
                {child.label}
              </span>
            </li>
          ))}
        </NestRow>
      )}
    </div>
  );
}
