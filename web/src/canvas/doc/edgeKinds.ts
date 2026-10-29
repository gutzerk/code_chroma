export type EdgeVisual = "call" | "spawn" | "data" | "minor" | "error" | "bundle";

const SPAWN = new Set(["spawn", "spawns", "process"]);
const DATA = new Set(["data", "read", "write", "reads", "writes"]);
const MINOR = new Set(["minor", "secondary"]);
const ERROR = new Set(["error", "failure", "fails"]);

/** Maps an edge's free-form `kind` (or `transport`) to the board's visual family; anything else is a plain call. */
export function edgeVisual(kind: string | undefined, transport?: string): EdgeVisual {
  for (const raw of [kind, transport]) {
    const value = (raw ?? "").toLowerCase();
    if (SPAWN.has(value)) return "spawn";
    if (DATA.has(value)) return "data";
    if (MINOR.has(value)) return "minor";
    if (ERROR.has(value)) return "error";
  }
  return "call";
}
