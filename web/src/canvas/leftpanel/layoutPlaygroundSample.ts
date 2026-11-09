import type { EngineClient } from "../../engine-client/EngineClient";
import type { CanvasOp } from "../../state/types";
import { canvasDocStore } from "../doc/canvasDocStore";
import { patchCanvasDoc } from "../doc/canvasDocSync";

/** The freeform layer the playground's sample diagram lives on; deleting it from the Diagrams tab removes it. */
export const SAMPLE_LAYER = "layout-playground-sample";

const BOXES: [id: string, label: string, description: string][] = [
  ["web", "Web app", "React canvas the user works in"],
  ["desktop", "Desktop shell", "Avalonia host window"],
  ["gateway", "API gateway", "Routes HTTP and WebSocket traffic"],
  ["auth", "Auth service", "Checks tokens and sessions"],
  ["graph", "Graph engine", "Parses the repo and builds the hierarchy"],
  ["summaries", "Summarizer", "Writes AI or offline summaries"],
  ["agents", "Agent runner", "Starts one CLI agent per worktree"],
  ["workflows", "Workflow runner", "Steerable multi-step runs with checkpoints"],
  ["queue", "Event queue", "Fan-out of change events"],
  ["watcher", "Repo watcher", "Detects file changes on disk"],
  ["store", "Graph store", "SQLite persistence"],
  ["canvasDoc", "Canvas document", "canvas.json with every element and edge"],
  ["git", "Git", "Worktrees, diffs and checkpoints"],
  ["claude", "Claude API", "External model provider"],
];

const EDGES: [from: string, to: string, label: string][] = [
  ["web", "gateway", "HTTP"],
  ["desktop", "web", "hosts"],
  ["gateway", "auth", "verify"],
  ["gateway", "graph", "analyze"],
  ["gateway", "agents", "start"],
  ["gateway", "workflows", "run"],
  ["gateway", "canvasDoc", "PATCH"],
  ["graph", "summaries", "summarize"],
  ["graph", "store", "save"],
  ["summaries", "claude", "prompt"],
  ["agents", "git", "worktree"],
  ["agents", "claude", "CLI"],
  ["workflows", "agents", "spawn"],
  ["workflows", "git", "checkpoint"],
  ["watcher", "queue", "changed"],
  ["queue", "graph", "reanalyze"],
  ["queue", "web", "ping"],
];

/** Draws a fixed sample diagram with no positions, so the canvas lays it out exactly as a first draw. */
export async function addSampleDiagram(
  engineClient: EngineClient,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const present = Object.values(canvasDocStore.getDoc().elements).some((element) => element.layer === SAMPLE_LAYER);
  if (present) return { ok: true };
  const ops: CanvasOp[] = [
    ...BOXES.map(([id, label, description]): CanvasOp => ({
      op: "add_element",
      temp_id: id,
      render: "c1",
      label,
      description,
      layer: SAMPLE_LAYER,
    })),
    ...EDGES.map(([from, to, label]): CanvasOp => ({
      op: "add_edge",
      from,
      to,
      label,
      kind: "uses",
      layer: SAMPLE_LAYER,
    })),
  ];
  const result = await patchCanvasDoc(engineClient, ops, {
    layer: SAMPLE_LAYER,
    explanation: "layout playground: sample diagram",
  });
  return result.ok ? { ok: true } : { ok: false, error: result.errors[0]?.message ?? "sample add failed" };
}
