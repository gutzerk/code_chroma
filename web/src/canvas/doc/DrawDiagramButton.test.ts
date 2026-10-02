import { describe, expect, it } from "vitest";
import { buildDrawDiagramTask } from "./DrawDiagramButton";

describe("buildDrawDiagramTask", () => {
  it("asks directly when 4 or fewer kinds are missing", () => {
    const task = buildDrawDiagramTask(["C1", "Design patterns", "Change impact"], false);

    expect(task).toContain("Ask which kind they'd like -- C1, Design patterns, Change impact --");
    expect(task).not.toContain("multiple-choice tool call");
  });

  it("tells the agent to answer in plain text once more than 4 kinds are missing", () => {
    // A real-world trigger: 3 missing built-ins plus 2+ custom diagram types the user has saved.
    const labels = ["C1", "Design patterns", "Change impact", "Server Comms", "MCP Lifecycle"];

    const task = buildDrawDiagramTask(labels, false);

    expect(task).toContain("not a multiple-choice tool call");
    expect(task).toContain(labels.join(", "));
  });

  it("says 'another' once at least one diagram is already drawn", () => {
    const task = buildDrawDiagramTask(["Change impact"], true);

    expect(task).toContain("wants another diagram");
  });

  it("asks what new diagram is wanted once nothing at all is missing", () => {
    // The button is unconditionally clickable now, including once every built-in/custom type is
    // already generated -- this is the empty-missingLabels case buildDrawDiagramTask must still
    // produce a sensible prompt for.
    const task = buildDrawDiagramTask([], true);

    expect(task).toContain("already drawn");
    expect(task).toContain("ask what new diagram");
    expect(task).not.toContain("Ask which kind");
  });
});
