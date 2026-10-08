import { createScriptedClient, type ScriptedClient } from "./scriptedSession";

export const DIAGRAM_CHOICES = [
  { label: "System context (C1)", recipe: "c1" },
  { label: "Design patterns", recipe: "patterns" },
  { label: "Change impact", recipe: "impact" },
] as const;

export interface DrawDiagramHooks {
  onChosen: () => void;
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
      prompt: "Draw a diagram of this project",
      intro: "I will use the codechroma-draw-diagram skill.",
      question: "Which diagram would you like?",
      options: DIAGRAM_CHOICES.map((choice) => choice.label),
      workLines: [
        "Reading the architecture wiki…",
        "Finding the people who use the app…",
        "Finding the systems it depends on…",
        "Drawing boxes and arrows…",
        "Self-check passed.",
      ],
      ack: (choice) => `${DIAGRAM_CHOICES[choice].label} it is.`,
      doneLine: (choice) => `Done. The ${DIAGRAM_CHOICES[choice].label} diagram is on your canvas.`,
      onChosen: hooks.onChosen,
      onDone: (choice) => hooks.onDone(DIAGRAM_CHOICES[choice].recipe),
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
      doneLine: () => "Done. The Change impact diagram is on your canvas.",
      onDone,
    });
  });
}
