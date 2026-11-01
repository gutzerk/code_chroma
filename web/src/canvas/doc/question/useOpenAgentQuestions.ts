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

/** How many open questions the given agents have in total (the Agents tab counter). */
export function useOpenQuestionCount(agentIds: readonly string[]): number {
  const doc = useCanvasDoc();
  return useMemo(
    () =>
      Object.values(doc.elements).filter(
        (el) => {
          const id = questionAgentId(el);
          return id !== null && agentIds.includes(id) && (el.meta.state ?? "open") === "open";
        },
      ).length,
    [doc.elements, agentIds],
  );
}
