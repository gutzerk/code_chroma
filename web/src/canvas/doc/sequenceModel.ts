import type { CanvasElement } from "../../state/types";
import { rawMeta, stringMeta } from "./elementMeta";
import { groupColorIndex, GROUP_COLOR_COUNT } from "./groupColor";

export interface SequenceParticipant {
  element: CanvasElement;
  ref: string;
  accent: string;
}

export interface SequenceMessage {
  element: CanvasElement;
  fromCol: CanvasElement;
  toCol: CanvasElement;
  fromRef: string;
  toRef: string;
  accent: string;
  order: number;
}

export interface SequencePhase {
  id: string;
  name: string;
  kind: string;
  from_order: number;
  to_order: number;
}

export interface SequenceFrameSpec {
  kind: string;
  label: string;
  from_order: number;
  to_order: number;
}

export interface SequenceNote {
  order: number;
  text: string;
}

export interface SequenceModel {
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
  phases: SequencePhase[];
  frames: SequenceFrameSpec[];
  notes: SequenceNote[];
}

/** The per-participant accent palette as `{r,g,b}`; kept in sync with groupColor.ts. */
const SEQUENCE_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [99, 102, 241],
  [52, 211, 153],
  [245, 158, 11],
  [244, 114, 182],
  [167, 139, 250],
  [34, 211, 238],
];
if (SEQUENCE_PALETTE.length !== GROUP_COLOR_COUNT) {
  throw new Error("SEQUENCE_PALETTE out of sync with GROUP_COLOR_COUNT");
}

/** 022 boards: a participant's colour follows its role (UI cyan, code blue, AI/external violet, data orange). */
const SEQUENCE_KIND_ACCENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(ai|llm|external)\b/, "180, 156, 255"],
  [/\b(ui|client|canvas|browser|actor|user|person)\b/, "34, 211, 238"],
  [/\b(data|db|database|store|storage|file|cache|queue)\b/, "251, 146, 60"],
  [/\b(route|routes|api|service|runner|cli|script|worker|server|handler|python|c#)\b/, "127, 184, 255"],
];

function sequenceAccentRef(ref: string, kind?: string): string {
  const key = (kind ?? "").toLowerCase();
  const byKind = SEQUENCE_KIND_ACCENTS.find(([re]) => re.test(key));
  if (byKind) return byKind[1];
  const [r, g, b] = SEQUENCE_PALETTE[groupColorIndex(ref) % SEQUENCE_PALETTE.length];
  return `${r}, ${g}, ${b}`;
}

/** Calls read neutral on the boards; ai/event/failure arrows recolour through their own class. */
const MESSAGE_ACCENT = "215, 218, 212";

/** `"2"` → 2, `"2a"`/`"2b"` → 2.01/2.02 (two messages at once sort right after their whole step). */
export function orderOf(element: CanvasElement): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z])?\s*$/i.exec(String(rawMeta(element, "order") ?? ""));
  if (!match) return 0;
  const letter = match[2] ? match[2].toLowerCase().charCodeAt(0) - 96 : 0;
  return Number(match[1]) + letter / 100;
}

function listMeta(elements: CanvasElement[], key: string): Record<string, unknown>[] {
  for (const element of elements) {
    const value = element.meta[key];
    if (Array.isArray(value) && value.length > 0) {
      return value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object");
    }
  }
  return [];
}

const num = (value: unknown): number => Number(value);

/** Participants, messages sorted by `order`, phases, frames and notes. */
export function buildSequenceModel(elements: CanvasElement[]): SequenceModel {
  const participants: SequenceParticipant[] = [];
  const byRef = new Map<string, CanvasElement>();
  for (const element of elements) {
    if (stringMeta(element, "role") !== "participant") continue;
    const ref = stringMeta(element, "recipe_key") ?? element.id;
    participants.push({ element, ref, accent: sequenceAccentRef(ref, stringMeta(element, "kind")) });
    byRef.set(element.id, element);
    byRef.set(ref, element);
  }

  const messages = elements
    .map((element): SequenceMessage | null => {
      if (stringMeta(element, "role") !== "message") return null;
      const fromRef = String(rawMeta(element, "from") ?? "");
      const toRef = String(rawMeta(element, "to") ?? "");
      const fromCol = byRef.get(fromRef);
      const toCol = byRef.get(toRef);
      if (!fromCol || !toCol) return null;
      return {
        element,
        fromCol,
        toCol,
        fromRef,
        toRef,
        accent: MESSAGE_ACCENT,
        order: orderOf(element),
      };
    })
    .filter((m): m is SequenceMessage => m !== null)
    .sort((a, b) => a.order - b.order);

  const phases = listMeta(elements, "phases")
    .map((p) => ({
      id: String(p.id ?? p.name ?? ""),
      name: String(p.name ?? p.id ?? ""),
      kind: String(p.kind ?? "custom"),
      from_order: num(p.from_order),
      to_order: num(p.to_order),
    }))
    .filter((p) => p.id && Number.isFinite(p.from_order) && Number.isFinite(p.to_order));
  const frames = listMeta(elements, "frames")
    .map((f) => ({
      kind: String(f.kind ?? "alt"),
      label: String(f.label ?? ""),
      from_order: num(f.from_order),
      to_order: num(f.to_order),
    }))
    .filter((f) => Number.isFinite(f.from_order) && Number.isFinite(f.to_order));
  const notes = listMeta(elements, "notes")
    .map((n) => ({ order: num(n.order ?? n.anchor), text: String(n.text ?? "") }))
    .filter((n) => Number.isFinite(n.order) && n.text);

  return { participants, messages, phases, frames, notes };
}
