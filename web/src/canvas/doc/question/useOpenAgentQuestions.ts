import { useMemo } from "react";
import type { CanvasDoc, CanvasElement } from "../../../state/types";
import { questionAgentId } from "./questionAdapter";

/** The open `question` elements an agent asked in `doc`, oldest step first. */
export function useOpenAgentQuestions(agentId: string, doc: CanvasDoc): CanvasElement[] {
  const elements = doc.elements;
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
