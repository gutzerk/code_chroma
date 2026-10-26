import { useEffect, useState } from "react";
import { useAgentClient } from "../../../agents/AgentClientContext";
import { useEngineClient } from "../../../engine-client/EngineClientContext";
import type { BuiltinDiagramKind, DiagramTypeSummary } from "../../../state/types";

/** One card in the Draw dialog: a built-in kind, or a saved custom type that names its own schematic. */
export interface DrawCard {
  /** The card's own id: the kind id, or `custom:<type id>` for a saved type. */
  id: string;
  /** The `diagram_type` sent to the bridge. */
  type: string;
  name: string;
  purpose: string;
  schematic: string;
  placeholder: string;
  /** Set for a saved type's card; named in the request so the agent draws that type. */
  customTypeId?: string;
}

const PLACEHOLDERS: Record<string, string> = {
  any: "e.g. How does a repo get analyzed and pushed to the canvas?",
  c1: "e.g. Include the GitHub and Claude APIs; split the bridge into layers",
  patterns: "e.g. Focus on the bridge and the canvas store",
  impact: "e.g. Also show the callers of GitSync this branch touches",
  plan: "e.g. Plan token auth for the bridge routes",
  sequence: "e.g. A file save → reanalyze → canvas refresh",
  custom: "e.g. Regenerate the ownership map",
};

const SAVED_PLACEHOLDER = "e.g. Focus on the parts that changed this week";

export function cardsFrom(kinds: readonly BuiltinDiagramKind[], saved: readonly DiagramTypeSummary[]): DrawCard[] {
  const builtIns = kinds.map<DrawCard>((kind) => ({
    id: kind.id,
    type: kind.id,
    name: kind.name,
    purpose: kind.purpose,
    schematic: kind.id,
    placeholder: PLACEHOLDERS[kind.id] ?? SAVED_PLACEHOLDER,
  }));
  const own = saved
    .filter((type) => type.schematic)
    .map<DrawCard>((type) => ({
      id: `custom:${type.id}`,
      type: "custom",
      name: type.title,
      purpose: type.description || "One of your saved diagram types",
      schematic: type.schematic ?? "custom",
      placeholder: SAVED_PLACEHOLDER,
      customTypeId: type.id,
    }));
  // The saved types sit just before the generic "Custom type" card, which stays last.
  const generic = builtIns.findIndex((card) => card.id === "custom");
  if (generic < 0) return [...builtIns, ...own];
  return [...builtIns.slice(0, generic), ...own, ...builtIns.slice(generic)];
}

export interface DiagramKinds {
  cards: DrawCard[];
  loading: boolean;
  error: string | null;
}

/** The dialog's cards: the bridge's built-in kinds plus the saved types that carry a schematic; loaded each time the dialog opens. */
export function useDiagramKinds(active: boolean): DiagramKinds {
  const agentClient = useAgentClient();
  const engineClient = useEngineClient();
  const [state, setState] = useState<DiagramKinds>({ cards: [], loading: true, error: null });

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    void (async () => {
      try {
        // A bridge without the library routes still gets the built-in cards.
        const [kinds, saved] = await Promise.all([
          agentClient.diagramKinds(),
          engineClient.listDiagramTypes().catch(() => []),
        ]);
        if (!cancelled) setState({ cards: cardsFrom(kinds, saved), loading: false, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : "couldn't load the diagram types";
        if (!cancelled) setState({ cards: [], loading: false, error: message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, agentClient, engineClient]);

  return state;
}
