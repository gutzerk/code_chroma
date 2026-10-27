import { SequenceDrawing } from "./SequenceReadable";
import type { SequenceModel } from "./sequenceModel";
import { sequenceViewStore, type SequenceView } from "./sequenceViewStore";

/** Matches `.sequence-timeline`'s width; the panel sits inside the diagram so the frame still contains it. */
const TIMELINE_WIDTH = 220;

export interface SequenceFocusProps {
  layer: string;
  model: SequenceModel;
  view: SequenceView;
}

/** Focus mode: phases fold to one row, one participant stays lit, a timeline panel tracks the step. */
export function SequenceFocus({ layer, model, view }: SequenceFocusProps) {
  const current = sequenceViewStore.getStep(layer);
  const collapsed = new Set(view.collapsed);
  const isFolded = (order: number) =>
    model.phases.some((p) => collapsed.has(p.id) && order >= p.from_order && order <= p.to_order);

  const togglePhase = (id: string) => {
    const next = collapsed.has(id) ? view.collapsed.filter((x) => x !== id) : [...view.collapsed, id];
    sequenceViewStore.setCollapsed(layer, next);
  };

  const phaseRows = model.phases
    .map((phase) => ({
      phase,
      count: model.messages.filter((m) => m.order >= phase.from_order && m.order <= phase.to_order).length,
    }))
    .filter((row) => row.count > 0);
  const here =
    phaseRows.find(({ phase }) => current !== null && current >= phase.from_order && current <= phase.to_order) ??
    phaseRows.find(({ phase }) => !collapsed.has(phase.id));
  const involvesFocus = (m: SequenceModel["messages"][number]) => m.fromRef === view.focus || m.toRef === view.focus;

  return (
    <SequenceDrawing
      layer={layer}
      mode="focus"
      model={model}
      focusRef={view.focus}
      activeStep={sequenceViewStore.getStep(layer)}
      isHidden={(m) => isFolded(m.order)}
      isDim={(m) => view.focus !== null && m.fromRef !== view.focus && m.toRef !== view.focus}
      onHeadClick={(ref) => sequenceViewStore.setFocus(layer, view.focus === ref ? null : ref)}
    >
      {({ left, top }) => (
        <>
          {model.phases.map((phase) => {
            const members = model.messages.filter((m) => m.order >= phase.from_order && m.order <= phase.to_order);
            if (members.length === 0) return null;
            const isCollapsed = collapsed.has(phase.id);
            const y = Math.min(...members.map((m) => m.element.position.y));
            const talkers = [...new Set(members.flatMap((m) => [m.fromCol.label, m.toCol.label]))];
            return (
              <button
                key={phase.id}
                type="button"
                className={`sequence-phase-row sequence-phase-row--${phase.kind}`}
                data-testid="sequence-phase-row"
                aria-expanded={!isCollapsed}
                style={{ position: "absolute", left: 0, top: y - top - 12, pointerEvents: "auto" }}
                onClick={() => togglePhase(phase.id)}
              >
                {`${isCollapsed ? "▸" : "▾"} ${phase.name}`}
                {!isCollapsed && (
                  <span className="sequence-phase-row-meta" data-testid="sequence-phase-row-count">
                    {` · ${members.length} message${members.length === 1 ? "" : "s"}`}
                    {view.focus !== null && ` · ${members.filter(involvesFocus).length} involve the focus`}
                  </span>
                )}
                {isCollapsed && (
                  <span className="sequence-phase-row-meta">
                    {` · ${members.length} call${members.length === 1 ? "" : "s"} · ${talkers.join(", ")}`}
                  </span>
                )}
              </button>
            );
          })}
          <div
            className="sequence-timeline"
            data-testid="sequence-timeline"
            style={{ position: "absolute", left: model.bounds.right - left - TIMELINE_WIDTH - 8, top: 8, pointerEvents: "auto" }}
          >
            <div className="sequence-timeline-phases" data-testid="sequence-timeline-phases">
              <div className="sequence-timeline-bars">
                {phaseRows.map(({ phase, count }) => (
                  <span
                    key={phase.id}
                    className={`sequence-timeline-bar sequence-timeline-bar--${phase.kind}`}
                    style={{ flexGrow: count }}
                  />
                ))}
              </div>
              <div className="sequence-timeline-names">
                {phaseRows.map(({ phase }) => (
                  <span
                    key={phase.id}
                    className={here?.phase.id === phase.id ? "sequence-timeline-name sequence-timeline-name--here" : "sequence-timeline-name"}
                    style={{ flexGrow: 1 }}
                  >
                    {here?.phase.id === phase.id ? `${phase.name} ← you are here` : phase.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="sequence-timeline-heading">PARTICIPANTS</div>
            <ul className="sequence-timeline-people" data-testid="sequence-timeline-participants">
              {model.participants.map((p) => {
                const focused = view.focus === p.ref;
                const count = model.messages.filter((m) => m.fromRef === p.ref || m.toRef === p.ref).length;
                return (
                  <li
                    key={p.ref}
                    className={focused ? "sequence-timeline-person sequence-timeline-person--focus" : "sequence-timeline-person"}
                    data-testid="sequence-timeline-participant"
                    aria-pressed={focused}
                    onClick={() => sequenceViewStore.setFocus(layer, focused ? null : p.ref)}
                  >
                    <span>{focused ? `${p.element.label} ●` : p.element.label}</span>
                    <span className="sequence-timeline-person-count">{`${count} msg${count === 1 ? "" : "s"}`}</span>
                  </li>
                );
              })}
            </ul>
            <div className="sequence-timeline-heading">STEPS</div>
            <ol className="sequence-timeline-steps">
              {model.messages.map((m) => (
                <li
                  key={m.element.id}
                  className={current === m.order ? "sequence-timeline-item sequence-timeline-item--here" : "sequence-timeline-item"}
                  aria-current={current === m.order ? "step" : undefined}
                  onClick={() => sequenceViewStore.setStep(layer, m.order)}
                >
                  {`${m.order} · ${m.element.label}`}
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </SequenceDrawing>
  );
}
