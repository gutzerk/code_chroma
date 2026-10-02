import { bridgeRequest, jsonInit } from "../util/httpJson";

export type ProviderKind = "cli" | "api";
export type Transport = "anthropic" | "openai-compatible";

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
}

export type ProviderDraft = Omit<Provider, "id"> & { api_key?: string | null };

export interface ProviderTestResult {
  ok: boolean;
  provider_id: string;
  message?: string;
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
}

export function fetchProviderModels(id: string): Promise<ProviderModelsResult> {
  return bridgeRequest<ProviderModelsResult>(`/llm/providers/${id}/models`);
}
