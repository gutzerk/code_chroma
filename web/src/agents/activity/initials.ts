/** Up to two uppercase letters from an agent title, for the collapsed strip's avatar. */
export function agentInitials(title: string): string {
  const words = title.trim().split(/[\s_\-/]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}
