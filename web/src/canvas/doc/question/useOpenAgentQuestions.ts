import { useMemo, useSyncExternalStore } from "react";
import type { CanvasElement } from "../../../state/types";
import { canvasDocStore, useCanvasDoc } from "../canvasDocStore";
import { questionAgentId } from "./questionAdapter";

/** The open `question` elements an agent asked, oldest step first (the queue shown one at a time). */
export function useOpenAgentQuestions(agentId: string): CanvasElement[] {
  const doc = useCanvasDoc();
  return useMemo(
    () =>
      Object.values(doc.elements)
        .filter(
          (el) => questionAgentId(el) === agentId && (el.meta.state ?? "open") === "open",
        )
        .sort((a, b) => Number(a.meta.step ?? 0) - Number(b.meta.step ?? 0)),
    [doc.elements, agentId],
  );
}

/** One count map per elements object, shared by every caller until the doc changes. */
const countsByElements = new WeakMap<Record<string, CanvasElement>, ReadonlyMap<string, number>>();

/** Open question counts per asking agent id; an agent with none is absent. */
export function openQuestionCounts(elements: Record<string, CanvasElement>): ReadonlyMap<string, number> {
  const cached = countsByElements.get(elements);
  if (cached) return cached;
  const counts = new Map<string, number>();
  for (const el of Object.values(elements)) {
    const id = questionAgentId(el);
    if (id !== null && (el.meta.state ?? "open") === "open") counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  countsByElements.set(elements, counts);
  return counts;
}

/** `openQuestionCounts` over the live canvas doc, recomputed only when its elements change. */
export function useOpenQuestionCounts(): ReadonlyMap<string, number> {
  return openQuestionCounts(useCanvasDoc().elements);
}

/** How many open questions `agentId` has; re-renders only when that number changes. */
export function useOpenQuestionCount(agentId: string): number {
  return useSyncExternalStore(
    canvasDocStore.subscribe,
    () => openQuestionCounts(canvasDocStore.getDoc().elements).get(agentId) ?? 0,
  );
}
