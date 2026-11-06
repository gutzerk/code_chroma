import { useMemo, useSyncExternalStore } from "react";
import type { CanvasDoc, CanvasElement } from "../../../state/types";
import { canvasDocStore, useCanvasDoc } from "../canvasDocStore";
import { questionAgentId } from "./questionAdapter";
import { workspaceQuestionDocs } from "./workspaceQuestionDocs";

/** The open `question` elements an agent asked in `doc` (the active canvas by default), oldest step first. */
export function useOpenAgentQuestions(agentId: string, doc?: CanvasDoc): CanvasElement[] {
  const activeDoc = useCanvasDoc();
  const elements = (doc ?? activeDoc).elements;
  return useMemo(
    () =>
      Object.values(elements)
        .filter(
          (el) => questionAgentId(el) === agentId && (el.meta.state ?? "open") === "open",
        )
        .sort((a, b) => Number(a.meta.step ?? 0) - Number(b.meta.step ?? 0)),
    [elements, agentId],
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

let merged: { active: Record<string, CanvasElement>; others: CanvasDoc[]; counts: ReadonlyMap<string, number> } | null = null;

/** Open question counts per agent across the active canvas and every other agent workspace, so a badge never depends on the active tab. */
export function agentOpenQuestionCounts(): ReadonlyMap<string, number> {
  const active = canvasDocStore.getDoc().elements;
  const others = workspaceQuestionDocs.getDocs();
  if (merged && merged.active === active && merged.others === others) return merged.counts;
  let counts = openQuestionCounts(active);
  if (others.length > 0) {
    const sum = new Map(counts);
    for (const doc of others) {
      openQuestionCounts(doc.elements).forEach((n, id) => sum.set(id, (sum.get(id) ?? 0) + n));
    }
    counts = sum;
  }
  merged = { active, others, counts };
  return counts;
}

/** Subscribes to every doc `agentOpenQuestionCounts` reads. */
export function subscribeQuestionDocs(listener: () => void): () => void {
  const active = canvasDocStore.subscribe(listener);
  const others = workspaceQuestionDocs.subscribe(listener);
  return () => {
    active();
    others();
  };
}

/** `agentOpenQuestionCounts` as a hook, recomputed only when a doc's elements change. */
export function useOpenQuestionCounts(): ReadonlyMap<string, number> {
  return useSyncExternalStore(subscribeQuestionDocs, agentOpenQuestionCounts);
}

/** How many open questions `agentId` has in any workspace; re-renders only when that number changes. */
export function useOpenQuestionCount(agentId: string): number {
  return useSyncExternalStore(subscribeQuestionDocs, () => agentOpenQuestionCounts().get(agentId) ?? 0);
}
