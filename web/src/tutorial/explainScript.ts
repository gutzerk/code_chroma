import { createScriptedClient, type ScriptedClient } from "./scriptedSession";

/** The pull-request agent: explains one block of the impact diagram, then splits it into steps. */
export function createExplainClient(onDone: () => void): ScriptedClient {
  return createScriptedClient((session) => {
    session.open();
    session.play({
      prompt: "Explain what add_todo does in this pull request, and show its steps on the diagram",
      intro: "I will read the diff and the impact diagram.",
      workLines: [
        "Reading the diff of backend/service.py…",
        "Reading the impact diagram…",
        "Splitting add_todo into steps on the canvas…",
      ],
      stepMs: 2200,
      doneLine: () =>
        "add_todo now does three things, in this order:\r\n" +
        "  1. checks the title with the new validate_title\r\n" +
        "  2. saves the todo through insert\r\n" +
        "  3. returns the saved todo\r\n" +
        "I split the add_todo block into these three steps on your canvas.",
      onDone,
    });
  });
}
