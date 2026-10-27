/** True when a lane is a failure lane: every member that sets `lane_kind` says failure, else (no member sets one) its name is "Failures". */
export function isFailureLane(name: string, kinds: readonly (string | undefined)[]): boolean {
  const set = kinds.filter((kind) => kind !== undefined);
  if (set.length > 0) return set.every((kind) => kind === "failure");
  // deprecated: the name fallback only serves diagrams that predate `lane_kind`
  return name.trim().toLowerCase() === "failures";
}
