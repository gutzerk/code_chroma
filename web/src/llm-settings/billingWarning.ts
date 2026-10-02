import type { Provider } from "./llmSettingsClient";

/** True only for a non-local direct-API provider (FR-010/FR-011): never for a CLI or local one. */
export function shouldWarnBilling(provider: Pick<Provider, "kind" | "is_local">): boolean {
  return provider.kind === "api" && !provider.is_local;
}
