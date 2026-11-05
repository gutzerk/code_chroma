import { useMemo } from "react";
import type { CanvasElement } from "../../../state/types";
import { useCanvasDoc } from "../canvasDocStore";
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

/** Open question counts per asking agent id; an agent with none is absent. */
export function openQuestionCounts(elements: Record<string, CanvasElement>): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const el of Object.values(elements)) {
    const id = questionAgentId(el);
    if (id !== null && (el.meta.state ?? "open") === "open") counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** `openQuestionCounts` over the live canvas doc, recomputed only when its elements change. */
export function useOpenQuestionCounts(): ReadonlyMap<string, number> {
  const doc = useCanvasDoc();
  return useMemo(() => openQuestionCounts(doc.elements), [doc.elements]);
}
