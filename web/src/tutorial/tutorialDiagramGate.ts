import type { EngineClient } from "../engine-client/EngineClient";
import { ROOT_NODE_ID } from "../state/types";
import { tutorialSimStore } from "./tutorialSim";
import { TUTORIAL_ROOT_NAME } from "./tutorialSteps";

/** Diagram kinds the tutorial project ships prebuilt and reveals one by one. */
export const GATED_DIAGRAM_KINDS = ["c1", "patterns", "impact"];

/** Wraps a client so the tutorial project's prebuilt diagrams report "not ready" until drawn.
 * It recognises the project itself (by its root name) on the first status fetch, so the gate is up
 * before any consumer can see — and auto-place — a diagram that exists only for the lesson. */
export function withTutorialDiagramGate(client: EngineClient): EngineClient {
  let isTutorialProject: Promise<boolean> | null = null;
  const detect = (target: EngineClient): Promise<boolean> => {
    isTutorialProject ??= target
      .getNode(ROOT_NODE_ID)
      .then((root) => {
        const tutorial = root?.name === TUTORIAL_ROOT_NAME;
        if (tutorial) tutorialSimStore.enableGate();
        return tutorial;
      })
      .catch(() => false);
    return isTutorialProject;
  };
  return new Proxy(client, {
    get(target, property) {
      if (property === "getDiagramsStatus") {
        return async () => {
          const [status] = await Promise.all([target.getDiagramsStatus(), detect(target)]);
          const gated = { ...status };
          for (const kind of GATED_DIAGRAM_KINDS) {
            if (gated[kind] && tutorialSimStore.isHidden(kind)) {
              gated[kind] = { ...gated[kind], ready: false };
            }
          }
          return gated;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
