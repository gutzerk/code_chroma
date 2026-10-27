/** True when a lane is a failure lane: any member says `lane_kind: failure`, else (only when no member sets a kind) its name is "Failures". */
export function isFailureLane(name: string, kinds: readonly (string | undefined)[]): boolean {
  if (kinds.some((kind) => kind === "failure")) return true;
  // deprecated: the name fallback only serves diagrams that predate `lane_kind`
  return kinds.every((kind) => kind === undefined) && name.trim().toLowerCase() === "failures";
}
