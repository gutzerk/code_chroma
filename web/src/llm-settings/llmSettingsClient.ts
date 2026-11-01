import { bridgeRequest, jsonInit } from "../util/httpJson";

export type ProviderKind = "cli" | "api";

/** What a connection can drive -- derived server-side (`providers_store.capabilities`), never stored. */
export interface Capabilities {
  agents: boolean;
  quick: boolean;
}
export type Transport = "anthropic" | "gemini" | "openai-compatible";

/** A masked provider payload -- the raw key never leaves the bridge (see providers_store.py). */
export interface Provider {
  id: string;
  label: string;
  kind: ProviderKind;
  adapter: string | null;
  transport: Transport | null;
  base_url: string | null;
  api_key_set: boolean;
  api_key_path: string | null;
  is_local: boolean;
  /** The model `POST .../test` probes with for an openai-compatible transport (unused otherwise). */
  test_model: string | null;
  /** openai-compatible only: skips TLS cert verification for a self-signed/private-CA endpoint. */
  verify_ssl: boolean;
  capabilities?: Capabilities;
  /** How many of the five features currently resolve to this connection. */
  used_by?: number;
}

export type ProviderDraft = Omit<Provider, "id"> & { api_key?: string | null };

export interface ProviderTestResult {
  ok: boolean;
  provider_id: string;
  message?: string;
  models_count?: number;
  error?: string;
}

export function listProviders(): Promise<Provider[]> {
  return bridgeRequest<Provider[]>("/llm/providers");
}

export function createProvider(draft: ProviderDraft): Promise<Provider> {
  return bridgeRequest<Provider>("/llm/providers", jsonInit("POST", draft));
}

export function updateProvider(id: string, draft: ProviderDraft): Promise<Provider> {
  return bridgeRequest<Provider>(`/llm/providers/${id}`, jsonInit("PUT", draft));
}

export function deleteProvider(id: string): Promise<void> {
  return bridgeRequest<void>(`/llm/providers/${id}`, jsonInit("DELETE"));
}

export function testProvider(id: string): Promise<ProviderTestResult> {
  return bridgeRequest<ProviderTestResult>(`/llm/providers/${id}/test`, jsonInit("POST", {}));
}

/** Tests a not-yet-saved draft from the Add/Edit form -- same result shape, no provider_id. */
export function testProviderDraft(draft: ProviderDraft): Promise<ProviderTestResult> {
  return bridgeRequest<ProviderTestResult>("/llm/providers/test", jsonInit("POST", draft));
}

export type CallSiteCapability = "simple" | "agentic";
export type CallSiteMode = "cli" | "api";

export interface CallSiteAssignment {
  provider_id: string;
  model: string;
  mode: CallSiteMode;
}

export interface CallSite {
  id: string;
  label: string;
  capability: CallSiteCapability;
  /** Plain-English "what this feature does", from `llm/call_sites.py`'s catalog. */
  description: string;
  assignment: CallSiteAssignment | null;
}

/** One provider+model choice covers every member at once (see `llm/call_sites.py`'s `GROUPS`). */
export interface CallSiteGroupMember {
  id: string;
  label: string;
  description: string;
}

export interface CallSiteGroupAssignment {
  provider_id: string;
  model: string;
}

export interface CallSiteGroup {
  id: string;
  label: string;
  members: CallSiteGroupMember[];
  assignment: CallSiteGroupAssignment | null;
  /** Whether the group's effective CLI (assigned, or the default `claude`) is on PATH right now. */
  cli_available: boolean;
}

export interface CallSitesResponse {
  simple: CallSite[];
  groups: CallSiteGroup[];
}

export function listCallSites(): Promise<CallSitesResponse> {
  return bridgeRequest<CallSitesResponse>("/llm/call-sites");
}

/** One group by id -- reads tab-hidden groups like `agents`, which `listCallSites` excludes. */
export function getCallSiteGroup(groupId: string): Promise<CallSiteGroup> {
  return bridgeRequest<CallSiteGroup>(`/llm/call-site-groups/${groupId}`);
}

/** Simple call sites only -- an agentic id here now 400s; use `assignCallSiteGroup`. */
export function assignCallSite(id: string, assignment: CallSiteAssignment): Promise<CallSite> {
  return bridgeRequest<CallSite>(`/llm/call-sites/${id}`, jsonInit("PUT", assignment));
}

export function clearCallSite(id: string): Promise<CallSite> {
  return bridgeRequest<CallSite>(`/llm/call-sites/${id}`, jsonInit("PUT", {}));
}

export function assignCallSiteGroup(
  groupId: string,
  assignment: CallSiteGroupAssignment
): Promise<CallSiteGroup> {
  return bridgeRequest<CallSiteGroup>(
    `/llm/call-site-groups/${groupId}`,
    jsonInit("PUT", assignment)
  );
}

export function clearCallSiteGroup(groupId: string): Promise<CallSiteGroup> {
  return bridgeRequest<CallSiteGroup>(`/llm/call-site-groups/${groupId}`, jsonInit("PUT", {}));
}

export interface ProviderModel {
  id: string;
  label: string | null;
}

/** A provider's own model catalog, queried live -- `supported: false` means it can't list them. */
export interface ProviderModelsResult {
  supported: boolean;
  models: ProviderModel[];
  error?: string | null;
  /** True when `models` is the built-in suggestion list rather than the provider's own answer. */
  static?: boolean;
}

export function fetchProviderModels(id: string): Promise<ProviderModelsResult> {
  return bridgeRequest<ProviderModelsResult>(`/llm/providers/${id}/models`);
}

/** A default's fallback: another connection + model, or (quick tasks only) no AI at all. */
export type DefaultFallback = { provider_id: string; model: string } | { offline: true };

export interface DefaultAssignment {
  provider_id: string;
  model: string;
  quick_fallback: DefaultFallback | null;
  agent_fallback: DefaultFallback | null;
}

export type DefaultDraft = Pick<DefaultAssignment, "provider_id" | "model"> &
  Partial<Pick<DefaultAssignment, "quick_fallback" | "agent_fallback">>;

export function getDefault(): Promise<{ default: DefaultAssignment | null }> {
  return bridgeRequest<{ default: DefaultAssignment | null }>("/llm/default");
}

export function putDefault(draft: DefaultDraft): Promise<{ default: DefaultAssignment | null }> {
  return bridgeRequest<{ default: DefaultAssignment | null }>("/llm/default", jsonInit("PUT", draft));
}

export type FeatureSource = "default" | "custom" | "fallback" | "offline" | "legacy";

/** One of the five user-facing rows, with the server-resolved connection and model it uses now. */
export interface Feature {
  id: string;
  label: string;
  description: string;
  needs: "agents" | "quick";
  effective: { provider_id: string | null; provider_name: string | null; model: string | null };
  source: FeatureSource;
  compatible_provider_ids: string[];
}

export function listFeatures(): Promise<{ features: Feature[] }> {
  return bridgeRequest<{ features: Feature[] }>("/llm/features");
}

/** Overrides one feature (blank model: the bridge picks); `offline` is for quick tasks only. */
export function putFeature(
  id: string,
  assignment: { provider_id: string; model: string } | { offline: true }
): Promise<Feature> {
  return bridgeRequest<Feature>(`/llm/features/${id}`, jsonInit("PUT", assignment));
}

/** Drops a feature's override so it follows the default again. */
export function deleteFeature(id: string): Promise<Feature> {
  return bridgeRequest<Feature>(`/llm/features/${id}`, jsonInit("DELETE"));
}

/** What an unsaved Add/Edit form could be used for -- the bridge owns the capability rule. */
export function fetchDraftCapabilities(
  draft: Record<string, unknown>
): Promise<{ capabilities: Capabilities }> {
  return bridgeRequest<{ capabilities: Capabilities }>(
    "/llm/providers/capabilities",
    jsonInit("POST", draft)
  );
}

export interface CliStatus {
  executable: string | null;
  version: string | null;
  failure_reason: string | null;
  /** From `GET /llm/cli/{adapter}/auth`; null when the CLI can't tell. */
  signed_in: boolean | null;
}

/** Where a CLI adapter resolves on PATH and whether it reports a signed-in account. */
export async function fetchCliStatus(adapter: string): Promise<CliStatus | null> {
  const name = encodeURIComponent(adapter);
  const [runtime, auth] = await Promise.all([
    bridgeRequest<{ resolution: Omit<CliStatus, "signed_in"> | null }>(`/runtime/cli/${name}`),
    bridgeRequest<{ signed_in: boolean | null }>(`/llm/cli/${name}/auth`).catch(() => ({ signed_in: null })),
  ]);
  return runtime.resolution && { ...runtime.resolution, signed_in: auth.signed_in };
}
