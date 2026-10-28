import type { Capabilities, Provider } from "./llmSettingsClient";

/** Display words for the two things a feature can need; `noun` reads inside a sentence. */
export const NEEDS_LABEL = {
  agents: { kind: "Agent", noun: "agent" },
  quick: { kind: "Quick task", noun: "quick task" },
} as const;

/** The one-line "what is this connection" subtitle, shown on its card and on the default chip. */
export function connectionSubtitle(provider: Provider): string {
  if (provider.kind === "cli") {
    return provider.base_url
      ? `${provider.adapter} → ${provider.base_url}`
      : `Runs the ${provider.adapter} command-line tool`;
  }
  if (provider.transport === "anthropic") return "Anthropic API";
  if (provider.transport === "gemini") return provider.base_url || "Gemini API";
  return provider.base_url || "openai-compatible endpoint";
}

/** "Agents + quick tasks" / "Agents only" / "Quick tasks only" -- the one line shown on a connection. */
export function capabilityText(caps: Capabilities | undefined): string {
  if (!caps) return "";
  if (caps.agents && caps.quick) return "Agents + quick tasks";
  if (caps.agents) return "Agents only";
  if (caps.quick) return "Quick tasks only";
  return "Nothing yet";
}

/** Why a connection has the capabilities it has, for the Add form's "Can be used for" strip. */
export function capabilityWhy(caps: Capabilities): string {
  if (caps.agents && caps.quick) return "works for every feature";
  if (caps.agents) return "quick tasks like code summaries need an API key";
  if (caps.quick) return "diagrams, planning and agent windows need a CLI tool";
  return "add an API key to use it";
}
