import { createScriptedClient, type ScriptedClient } from "./scriptedSession";
import type { TutorialFeature } from "./tutorialPlan";

/** The second agent: a scripted `claude` that builds the feature planned on the diagram. */
export function createImplementClient(
  feature: TutorialFeature,
  onDone: () => void,
): ScriptedClient {
  return createScriptedClient((session) => {
    session.open();
    session.play({
      prompt: `Build the "${feature.label}" feature planned on the diagram`,
      intro: "I will read the plan from the canvas and write the code.",
      workLines: [
        "Reading the two planned blocks…",
        `Editing backend/service.py: adding ${feature.service.name}()`,
        `Editing db/repository.py: adding ${feature.storage.name}()`,
        "Running the tests…",
        "4 passed in 0.31s",
      ],
      stepMs: 2600,
      doneLine: () => `Done. ${feature.service.name}() and ${feature.storage.name}() are written.`,
      onDone,
    });
  });
}
