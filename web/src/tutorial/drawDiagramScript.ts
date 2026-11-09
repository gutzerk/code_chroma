import { createScriptedClient, type ScriptedClient } from "./scriptedSession";

export interface DrawDiagramHooks {
  onDone: (recipe: string) => void;
}

/** The first agent: a scripted `claude` running the draw-diagram skill, driven through a real xterm.
 * A `resumed` one skips the question and only recalls the diagram it already drew. */
export function createDrawDiagramClient(
  hooks: DrawDiagramHooks,
  resumed = false,
): ScriptedClient {
  return createScriptedClient((session) => {
    if (resumed) {
      session.open("Earlier I drew the Design patterns diagram for this project.");
      return;
    }
    session.open();
    session.play({
      prompt: "Draw a Design patterns diagram of this project",
      intro: "I will use the codechroma-draw-diagram skill.",
      workLines: [
        "Reading the architecture wiki…",
        "Finding the patterns in the code…",
        "Drawing boxes and arrows…",
        "Self-check passed.",
      ],
      doneLine: () => "Done. The Design patterns diagram is on your canvas.",
      onDone: () => hooks.onDone("patterns"),
    });
  });
}

/** The agent a pull request opened with "build the impact diagram" starts: no question, the type is set. */
export function createImpactClient(task: string, onDone: () => void): ScriptedClient {
  return createScriptedClient((session) => {
    session.open();
    session.play({
      prompt: task,
      intro: "I will use the codechroma-draw-diagram skill.",
      workLines: [
        "Reading the diff of the pull request…",
        "Finding the code the change talks to…",
        "Drawing the Change impact diagram…",
        "Self-check passed.",
      ],
      stepMs: 400,
      doneLine: () => "Done. The Change impact diagram is on your canvas.",
      onDone,
    });
  });
}
