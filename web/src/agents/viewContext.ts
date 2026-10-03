/** The active canvas view, mirroring RootCanvas's `CanvasView` union without importing it (RootCanvas
 *  doesn't export the type). */
export type CanvasViewId = "hierarchy" | "c1" | "pattern" | "epic" | "custom" | "impact";

/** The two fields of EpicsFocusState a view description reads; an object that is already a full
 *  EpicsFocusState (RootCanvas) or a minimal {focusedId, showAiBrief} partial (EpicsView) both fit. */
export interface EpicsContextPart {
  focusedId: string | null;
  showAiBrief: boolean;
}

/** A short, human sentence describing what the user is currently looking at, built synchronously at
 *  launch time from state that is already loaded — never fetched on the launch path. Delivered to the
 *  fresh agent as acknowledge-only context (see parallel-agents.md). */
export interface ViewContext {
  workspace: string;
  description: string;
}

/** Everything already available in stores/canvas at launch time that a view's description needs.
 *  Each field is best-effort: a missing piece just makes the sentence shorter, never aborts the
 *  launch. */
export interface ViewContextInput {
  workspace: string;
  view: CanvasViewId;
  epics?: EpicsContextPart;
  epicTitle?: string;
  epicSource?: string;
  c1System?: { name: string; description: string };
  patternsCount?: number;
  customTitle?: string;
  customDescription?: string;
  /** Impact slice node count — used to size the "N nodes affected" launch context line. */
  impactCount?: number;
  breadcrumb?: string[];
}

/** Builds the acknowledgment line. Returns null when nothing meaningful is available (no active
 *  view context worth telling the agent about). */
export function buildViewContext(input: ViewContextInput): ViewContext | null {
  let description: string | undefined;
  switch (input.view) {
    case "epic": {
      const focusedId = input.epics?.focusedId ?? null;
      if (!focusedId) {
        description = "the Epics requirements view, with no epic focused yet";
        break;
      }
      const mode = input.epics?.showAiBrief ? "AI brief" : "requirements";
      if (input.epicTitle) {
        description = `the ${mode} for epic "${input.epicTitle}" (id ${focusedId})`;
        if (input.epicSource) description += `; its source lives at ${input.epicSource}`;
      } else {
        description = `the ${mode} for epic (id ${focusedId})`;
      }
      break;
    }
    case "c1": {
      if (input.c1System?.name) {
        description = `the C1 system-context diagram "${input.c1System.name}"`;
        if (input.c1System.description) description += `: ${input.c1System.description}`;
      } else {
        description = "the C1 system-context diagram";
      }
      break;
    }
    case "pattern":
      description =
        input.patternsCount === undefined
          ? "the design-patterns diagram"
          : `the design-patterns diagram (${input.patternsCount} patterns detected)`;
      break;
    case "custom": {
      if (input.customTitle) {
        description = `the custom diagram "${input.customTitle}"`;
        if (input.customDescription) description += `: ${input.customDescription}`;
      } else {
        description = "a custom diagram";
      }
      break;
    }
    case "hierarchy": {
      const trail = input.breadcrumb?.length
        ? input.breadcrumb.join(" › ")
        : "the repository root";
      description = `the code hierarchy, at ${trail}`;
      break;
    }
    case "impact":
      description =
        input.impactCount === undefined
          ? "the impact diagram"
          : `the impact diagram (${input.impactCount} node${input.impactCount === 1 ? "" : "s"} affected)`;
      break;
  }

  if (!description) return null;
  return { workspace: input.workspace, description };
}
