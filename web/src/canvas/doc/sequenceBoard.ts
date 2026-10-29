import type { CanvasDoc, CanvasElement, CanvasPosition, CanvasSize } from "../../state/types";
import { flagMeta, stringMeta } from "./elementMeta";
import { buildSequenceModel, type SequenceMessage, type SequenceParticipant } from "./sequenceModel";
import type { SequenceView } from "./sequenceViewStore";

/** A4 "glance + expand in place" board geometry; every value mirrors the design mockup. */
export const SEQUENCE_BOARD = {
  pillY: 6,
  pillH: 24,
  lanesTop: 44,
  laneGap: 8,
  laneH: 90,
  labelX: 16,
  labelW: 112,
  firstColX: 140,
  colGap: 18,
  boxW: 116,
  boxH: 54,
  boxTop: 18,
  expandedW: 380,
  expandedH: 240,
  expandedTop: 12,
  failLaneH: 70,
  failBoxH: 38,
  failTop: 16,
  failStack: 46,
  rightPad: 8,
  legendGap: 20,
  /** A phase pill narrower than this drops its side rules and shows just the label. */
  soloPillW: 140,
  legendLineH: 28,
  /** The `.seq-legend` row on one line: the widest browser measure (Linux 1818, macOS 1802; its glyphs fall back to system fonts) rounded up; e2e/box-size-guard.spec.ts guards it. */
  legendNaturalW: 1830,
} as const;

/** What a step box is, which picks its colour: the mockup's legend swatches. */
export type StepTone = "actor" | "route" | "logic" | "ai" | "check" | "data" | "fail";

/** How a step box is drawn: a numbered box, or a START/END pill for the first/last step. */
export type StepShape = "step" | "start" | "end";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardLane {
  id: string;
  label: string;
  tone: "plain" | "ai" | "fail";
  /** The most common tone of this lane's steps; tints the lane so lanes read apart (null: no steps). */
  role: StepTone | null;
  participant: SequenceParticipant | null;
  rect: Rect;
}

export interface BoardStep {
  id: string;
  message: SequenceMessage;
  tone: StepTone;
  shape: StepShape;
  /** "01".."NN" for numbered steps, "" for START/END. */
  number: string;
  expanded: boolean;
  lane: BoardLane;
  rect: Rect;
  note: string | null;
}

export type ArrowKind = "main" | "side" | "fail";

export interface BoardArrow {
  id: string;
  kind: ArrowKind;
  /** SVG path data in board coordinates. */
  d: string;
  /** Order of the step the arrow leads into, for the player's fade. */
  order: number;
}

export interface BoardPill {
  id: string;
  label: string;
  kind: string;
  x: number;
  w: number;
}

export interface BoardFrame {
  id: string;
  label: string;
  rect: Rect;
}

export interface SequenceBoard {
  lanes: BoardLane[];
  steps: BoardStep[];
  arrows: BoardArrow[];
  pills: BoardPill[];
  frames: BoardFrame[];
  width: number;
  /** Bottom of the last lane; the legend sits `legendGap` below it. */
  lanesBottom: number;
  height: number;
}

const AI_KIND = /\b(ai|llm|claude|model)\b/i;
const ACTOR_KIND = /\b(actor|user|person|developer|human|ui|client|browser)\b/i;
const ROUTE_KIND = /\b(route|routes|api|handler|endpoint|controller|http)\b/i;
const DATA_KIND = /\b(data|db|database|store|storage|file|files|cache|queue|disk)\b/i;
const CHECK_LABEL = /\b(verif\w*|check\w*|validat\w*|test\w*|lint\w*|assert\w*)\b/i;

const participantKind = (p: SequenceParticipant | undefined): string =>
  p ? `${stringMeta(p.element, "kind") ?? ""} ${stringMeta(p.element, "shape") ?? ""}` : "";

/** Whether a message is a failure path: it drops into the EX / Failures lane. */
export function isFailureMessage(message: SequenceMessage): boolean {
  return stringMeta(message.element, "kind") === "error" || flagMeta(message.element, "failure");
}

/** Derives a step's colour role from the message and its two participants (no extra JSON needed). */
export function stepTone(message: SequenceMessage, from?: SequenceParticipant, to?: SequenceParticipant): StepTone {
  if (isFailureMessage(message)) return "fail";
  const kind = stringMeta(message.element, "kind");
  const fromKind = participantKind(from);
  if (kind === "ai" || AI_KIND.test(fromKind)) return "ai";
  if (CHECK_LABEL.test(message.element.label)) return "check";
  if (ACTOR_KIND.test(fromKind) || (from && flagMeta(from.element, "external"))) return "actor";
  if (ROUTE_KIND.test(fromKind)) return "route";
  if (DATA_KIND.test(fromKind) || DATA_KIND.test(participantKind(to))) return "data";
  return "logic";
}

/** Lane-tint tie-break: on equal step counts the earlier role wins, so step order never flips a lane's colour. */
const TONE_PRIORITY: readonly StepTone[] = ["fail", "ai", "check", "data", "route", "actor", "logic"];

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Lays one sequence layer out as swimlanes: one lane per participant, one column per step. */
/** A cheap change key over everything the board reads from its elements, for memos fed fresh arrays. */
export function sequenceBoardSignature(elements: readonly CanvasElement[]): string {
  return elements.map((e) => JSON.stringify([e.id, e.label, e.description, e.node_id, e.meta, e.position, e.size])).join("|");
}

export function buildSequenceBoard(elements: CanvasElement[], expandedIds: readonly string[] = []): SequenceBoard {
  const B = SEQUENCE_BOARD;
  const model = buildSequenceModel(elements);
  const expanded = new Set(expandedIds);
  const byRef = new Map<string, SequenceParticipant>();
  for (const p of model.participants) {
    byRef.set(p.ref, p);
    byRef.set(p.element.id, p);
  }
  const main = model.messages.filter((m) => !isFailureMessage(m));
  const failures = model.messages.filter(isFailureMessage);

  const colX: number[] = [];
  let x: number = B.firstColX;
  for (const m of main) {
    colX.push(x);
    x += (expanded.has(m.element.id) ? B.expandedW : B.boxW) + B.colGap;
  }
  const width = Math.max(x - B.colGap + B.rightPad, B.firstColX + B.boxW + B.rightPad);

  const laneOf = (m: SequenceMessage): SequenceParticipant | undefined => byRef.get(m.fromRef);
  const lanes: BoardLane[] = [];
  let y: number = B.lanesTop;
  model.participants.forEach((p, index) => {
    const own = main.filter((m) => laneOf(m) === p);
    const h = own.some((m) => expanded.has(m.element.id)) ? B.expandedTop * 2 + B.expandedH : B.laneH;
    lanes.push({
      id: p.element.id,
      label: `${pad2(index + 1)} / ${p.element.label}`,
      tone: AI_KIND.test(participantKind(p)) ? "ai" : "plain",
      role: null,
      participant: p,
      rect: { x: 0, y, w: width, h },
    });
    y += h + B.laneGap;
  });
  const failColumn = (m: SequenceMessage): number => {
    let col = 0;
    main.forEach((other, index) => {
      if (other.order <= m.order) col = index;
    });
    return col;
  };
  // Each failure's column (the step it branches from) and its stack row under that column, computed once.
  const failSlot = new Map<SequenceMessage, { col: number; row: number }>();
  const perCol = new Map<number, number>();
  for (const m of failures) {
    const col = failColumn(m);
    const row = perCol.get(col) ?? 0;
    perCol.set(col, row + 1);
    failSlot.set(m, { col, row });
  }
  const failRows = Math.max(0, ...perCol.values());
  let failLane: BoardLane | null = null;
  if (failures.length > 0) {
    const h = B.failLaneH + (failRows - 1) * B.failStack;
    failLane = { id: "__failures", label: "EX / Failures", tone: "fail", role: "fail", participant: null, rect: { x: 0, y, w: width, h } };
    lanes.push(failLane);
    y += h + B.laneGap;
  }
  const lanesBottom = y - B.laneGap;
  const laneByParticipant = new Map(lanes.filter((l) => l.participant).map((l) => [l.participant as SequenceParticipant, l]));

  const noteFor = (order: number): string | null => model.notes.find((n) => n.order === order)?.text ?? null;
  const pills = main.length >= 3;
  let numbered = 0;
  const steps: BoardStep[] = main.map((m, index) => {
    const lane = laneByParticipant.get(laneOf(m) as SequenceParticipant) ?? lanes[0];
    const isOpen = expanded.has(m.element.id);
    const shape: StepShape = pills && index === 0 ? "start" : pills && index === main.length - 1 ? "end" : "step";
    if (shape === "step") numbered += 1;
    return {
      id: m.element.id,
      message: m,
      tone: stepTone(m, byRef.get(m.fromRef), byRef.get(m.toRef)),
      shape,
      number: shape === "step" ? pad2(numbered) : "",
      expanded: isOpen,
      lane,
      rect: isOpen
        ? { x: colX[index], y: lane.rect.y + B.expandedTop, w: B.expandedW, h: B.expandedH }
        : { x: colX[index], y: lane.rect.y + B.boxTop, w: B.boxW, h: B.boxH },
      note: noteFor(m.order),
    };
  });
  for (const m of failures) {
    const { col, row } = failSlot.get(m) as { col: number; row: number };
    const lane = failLane as BoardLane;
    steps.push({
      id: m.element.id,
      message: m,
      tone: "fail",
      shape: "step",
      number: "",
      expanded: false,
      lane,
      rect: { x: colX[col] ?? B.firstColX, y: lane.rect.y + B.failTop + row * B.failStack, w: B.boxW, h: B.failBoxH },
      note: noteFor(m.order),
    });
  }

  for (const lane of lanes) {
    const counts = new Map<StepTone, number>();
    for (const s of steps) if (s.lane === lane) counts.set(s.tone, (counts.get(s.tone) ?? 0) + 1);
    let best = 0;
    for (const tone of TONE_PRIORITY) {
      const n = counts.get(tone) ?? 0;
      if (n > best) [best, lane.role] = [n, tone];
    }
  }

  const arrows: BoardArrow[] = [];
  const rowY = (step: BoardStep): number => step.lane.rect.y + B.boxTop + B.boxH / 2;
  const mainSteps = steps.filter((s) => s.lane !== failLane);
  for (let i = 1; i < mainSteps.length; i += 1) {
    const a = mainSteps[i - 1];
    const b = mainSteps[i];
    const ax = a.rect.x + a.rect.w;
    const bx = b.rect.x - 1;
    const ay = rowY(a);
    const by = rowY(b);
    const d = ay === by ? `M${ax},${ay} H${bx}` : `M${ax},${ay} H${ax + B.colGap / 2} V${by} H${bx}`;
    arrows.push({ id: `${a.id}->${b.id}`, kind: flagMeta(b.message.element, "async") ? "side" : "main", d, order: b.message.order });
  }
  for (const s of steps) {
    if (s.lane !== failLane) continue;
    const parent = mainSteps[failSlot.get(s.message)?.col ?? 0];
    const cx = (parent ? parent.rect.x + B.boxW / 2 : s.rect.x + B.boxW / 2);
    const top = parent ? parent.rect.y + parent.rect.h : s.lane.rect.y;
    arrows.push({ id: `fail-${s.id}`, kind: "fail", d: `M${cx},${top} V${s.rect.y - 1}`, order: s.message.order });
  }

  const columnsIn = (from: number, to: number): BoardStep[] =>
    mainSteps.filter((s) => s.message.order >= from && s.message.order <= to);
  const pillList: BoardPill[] = model.phases.flatMap((phase) => {
    const cols = columnsIn(phase.from_order, phase.to_order);
    if (cols.length === 0) return [];
    const left = Math.min(...cols.map((s) => s.rect.x));
    const right = Math.max(...cols.map((s) => s.rect.x + s.rect.w));
    return [{ id: phase.id, label: phase.name, kind: phase.kind, x: left, w: right - left }];
  });
  const frames: BoardFrame[] = model.frames.flatMap((frame, index) => {
    const cols = columnsIn(frame.from_order, frame.to_order);
    if (cols.length === 0) return [];
    const left = Math.min(...cols.map((s) => s.rect.x)) - B.colGap / 3;
    const right = Math.max(...cols.map((s) => s.rect.x + s.rect.w)) + B.colGap / 3;
    const bottom = failLane ? failLane.rect.y - B.laneGap : lanesBottom;
    return [{
      id: `frame-${index}`,
      label: `${frame.kind} ${frame.label}`.trim(),
      rect: { x: left, y: B.lanesTop + 2, w: right - left, h: bottom - B.lanesTop - 4 },
    }];
  });

  const legendLines = Math.max(1, Math.ceil(B.legendNaturalW / width));
  const height = lanesBottom + B.legendGap + legendLines * B.legendLineH;
  return { lanes, steps, arrows, pills: pillList, frames, width, lanesBottom, height };
}

/** The board's top-left in document coordinates, anchored on the first lane's persisted centre. */
export function boardOrigin(board: SequenceBoard): { x: number; y: number } | null {
  const lane = board.lanes.find((l) => l.participant);
  if (!lane?.participant) return null;
  const { position } = lane.participant.element;
  return { x: position.x - (lane.rect.x + lane.rect.w / 2), y: position.y - (lane.rect.y + lane.rect.h / 2) };
}

/** The whole board's document rect (pills, lanes, legend) for already view-laid-out members. */
export function sequenceBoardBounds(
  members: CanvasElement[],
  expandedIds: readonly string[],
): { left: number; top: number; right: number; bottom: number } | null {
  const board = buildSequenceBoard(members, expandedIds);
  const origin = boardOrigin(board);
  if (!origin) return null;
  return { left: origin.x, top: origin.y, right: origin.x + board.width, bottom: origin.y + board.height };
}

/** Persisted positions/sizes for a sequence layer: a participant is its lane rect, a message its step box; `view.expanded` grows opened steps. */
export function layoutSequence(
  doc: CanvasDoc,
  ids: readonly string[],
  view?: SequenceView,
): { positions: Record<string, CanvasPosition>; sizes: Record<string, CanvasSize> } {
  const positions: Record<string, CanvasPosition> = {};
  const sizes: Record<string, CanvasSize> = {};
  if (ids.length === 0) return { positions, sizes };
  const elements = ids
    .map((id) => doc.elements[id])
    .filter((element): element is NonNullable<typeof element> => Boolean(element));
  const board = buildSequenceBoard(elements, view?.expanded ?? []);
  const place = (id: string, rect: { x: number; y: number; w: number; h: number }) => {
    positions[id] = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    sizes[id] = { w: rect.w, h: rect.h };
  };
  for (const lane of board.lanes) if (lane.participant) place(lane.participant.element.id, lane.rect);
  for (const step of board.steps) place(step.id, step.rect);
  return { positions, sizes };
}

/** Display-only geometry for the viewer's expanded steps, anchored to the persisted layout so a frame drag survives. */
export function viewSequenceElements(
  doc: CanvasDoc,
  ids: readonly string[],
  view: SequenceView,
): CanvasElement[] {
  const elements = ids.map((id) => doc.elements[id]).filter((e): e is CanvasElement => Boolean(e));
  const base = layoutSequence(doc, ids);
  const next = view.expanded.length > 0 ? layoutSequence(doc, ids, view) : base;
  const anchor = elements.find((e) => base.positions[e.id]);
  if (!anchor) return elements;
  const dx = anchor.position.x - base.positions[anchor.id].x;
  const dy = anchor.position.y - base.positions[anchor.id].y;
  return elements.map((element) => {
    const p = next.positions[element.id];
    if (!p) return element;
    return { ...element, position: { x: p.x + dx, y: p.y + dy }, size: next.sizes[element.id] ?? element.size };
  });
}
