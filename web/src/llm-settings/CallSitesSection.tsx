import { useEffect, useState } from "react";
import { messageOf } from "../util/reportError";
import { BillingWarningBadge } from "./BillingWarningBadge";
import { HelpHint } from "./HelpHint";
import {
  assignCallSite,
  assignCallSiteGroup,
  clearCallSite,
  clearCallSiteGroup,
  fetchProviderModels,
  listCallSites,
  listProviders,
  type CallSite,
  type CallSiteGroup,
  type CallSiteMode,
  type Provider,
  type ProviderModelsResult,
} from "./llmSettingsClient";

/** `modelCatalog` entry while a fetch is in flight -- distinct from a resolved `ProviderModelsResult`. */
type ModelCatalogEntry = ProviderModelsResult | { loading: true };

interface RowDraft {
  providerId: string;
  model: string;
  mode: CallSiteMode;
}

interface GroupRowDraft {
  providerId: string;
  model: string;
}

function draftFor(callSite: CallSite): RowDraft {
  const assignment = callSite.assignment;
  return {
    providerId: assignment?.provider_id ?? "",
    model: assignment?.model ?? "",
    mode: assignment?.mode ?? "api",
  };
}

function draftForGroup(group: CallSiteGroup): GroupRowDraft {
  return {
    providerId: group.assignment?.provider_id ?? "",
    model: group.assignment?.model ?? "",
  };
}

/** Every AI call site, its current assignment, and a capability-gated form to (re)assign it.
 * `simple` call sites are assigned one at a time; `agentic` ones are assigned by their group
 * (see `llm/call_sites.py`'s `GROUPS`), so one provider choice covers a whole task type such as
 * "Diagrams" instead of repeating the same pick across every diagram skill. */
export function CallSitesSection() {
  const [simple, setSimple] = useState<CallSite[] | null>(null);
  const [groups, setGroups] = useState<CallSiteGroup[] | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [groupDrafts, setGroupDrafts] = useState<Record<string, GroupRowDraft>>({});
  // Keyed by provider id (shared across both tables -- the same provider can be picked in either).
  const [modelCatalog, setModelCatalog] = useState<Record<string, ModelCatalogEntry>>({});

  const refreshCallSites = () =>
    listCallSites()
      .then(({ simple: simpleSites, groups: callSiteGroups }) => {
        setSimple(simpleSites);
        setGroups(callSiteGroups);
        setDrafts((prev) => {
          const next = { ...prev };
          for (const site of simpleSites) {
            if (!next[site.id]) next[site.id] = draftFor(site);
          }
          return next;
        });
        setGroupDrafts((prev) => {
          const next = { ...prev };
          for (const group of callSiteGroups) {
            if (!next[group.id]) next[group.id] = draftForGroup(group);
          }
          return next;
        });
      })
      .catch((err) => setError(messageOf(err)));

  const refreshProviders = () => listProviders().then(setProviders).catch(() => {});

  useEffect(() => {
    refreshCallSites();
    refreshProviders();
  }, []);

  const setDraft = (id: string, patch: Partial<RowDraft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const setGroupDraft = (id: string, patch: Partial<GroupRowDraft>) =>
    setGroupDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  /** Asks a provider for its own model list -- explicit action, never fetched automatically. */
  const loadModels = async (providerId: string) => {
    if (!providerId) return;
    setModelCatalog((c) => ({ ...c, [providerId]: { loading: true } }));
    try {
      const result = await fetchProviderModels(providerId);
      setModelCatalog((c) => ({ ...c, [providerId]: result }));
    } catch (err) {
      setModelCatalog((c) => ({
        ...c,
        [providerId]: { supported: true, models: [], error: messageOf(err) },
      }));
    }
  };

  const datalistId = (providerId: string) => `llm-call-site-models-${providerId || "none"}`;

  /** The inline status line under a Model input, once a fetch has been attempted. */
  const modelCatalogStatus = (providerId: string): { text: string; isError: boolean } | null => {
    const entry = modelCatalog[providerId];
    if (!entry) return null;
    if ("loading" in entry) return { text: "Fetching…", isError: false };
    if (entry.error) return { text: entry.error, isError: true };
    if (!entry.supported) {
      return {
        text: "This provider can't list its models — type the name directly.",
        isError: false,
      };
    }
    const count = entry.models.length;
    const text = count === 0 ? "No models returned" : `${count} model${count === 1 ? "" : "s"} available`;
    return { text, isError: false };
  };

  const eligibleProviders = (mode: CallSiteMode) =>
    providers.filter((p) => (mode === "cli" ? p.kind === "cli" : p.kind === "api"));

  const cliProviders = providers.filter((p) => p.kind === "cli");

  const assign = async (site: CallSite) => {
    const draft = drafts[site.id];
    if (!draft?.providerId) return;
    setError(null);
    try {
      await assignCallSite(site.id, {
        provider_id: draft.providerId, model: draft.model, mode: draft.mode,
      });
      refreshCallSites();
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const clear = async (site: CallSite) => {
    setError(null);
    try {
      await clearCallSite(site.id);
      refreshCallSites();
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const assignGroup = async (group: CallSiteGroup) => {
    const draft = groupDrafts[group.id];
    if (!draft?.providerId) return;
    setError(null);
    try {
      await assignCallSiteGroup(group.id, { provider_id: draft.providerId, model: draft.model });
      refreshCallSites();
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const clearGroup = async (group: CallSiteGroup) => {
    setError(null);
    try {
      await clearCallSiteGroup(group.id);
      refreshCallSites();
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const providerLabel = (id: string) => providers.find((p) => p.id === id)?.label ?? id;

  /** Apply only shows once the row differs from what is saved -- 11 idle buttons is noise. */
  const isDirty = (site: CallSite, draft: RowDraft) => {
    const saved = draftFor(site);
    return (
      draft.providerId !== saved.providerId ||
      draft.model !== saved.model ||
      draft.mode !== saved.mode
    );
  };

  const isGroupDirty = (group: CallSiteGroup, draft: GroupRowDraft) => {
    const saved = draftForGroup(group);
    return draft.providerId !== saved.providerId || draft.model !== saved.model;
  };

  const assignedProvider = (site: CallSite): Provider | undefined =>
    site.assignment ? providers.find((p) => p.id === site.assignment?.provider_id) : undefined;

  const assignedGroupProvider = (group: CallSiteGroup): Provider | undefined =>
    group.assignment ? providers.find((p) => p.id === group.assignment?.provider_id) : undefined;

  return (
    <div className="llm-tab-body" data-testid="llm-call-sites-section">
      <div className="llm-tab-head">
        <p className="llm-tab-hint">
          Point a feature at one of your providers. Left on <strong>Default</strong> it behaves
          exactly as it does today.
        </p>
        <HelpHint label="What model routing does" testId="llm-call-sites-help">
          <strong>Every row is one place the app calls a model.</strong>
          <ul>
            <li>
              <strong>Default</strong> — the feature keeps today's behaviour: the CLI from the Agent
              windows tab, or the API key from your environment.
            </li>
            <li>
              Pick a provider and type a model name, then press <strong>Apply</strong>.
            </li>
            <li>
              A <strong>simple</strong> feature makes one model call, so it can go through a direct
              API or a CLI. An <strong>agentic</strong> feature runs a whole CLI session, so only a
              command-line provider can serve it — and since a whole task type (e.g. every diagram
              skill) usually shares one provider, agentic features are assigned as a group: pick
              once, and it applies to every skill listed under that group.
            </li>
            <li>
              <strong>Reset</strong> puts the feature (or group) back to Default.
            </li>
          </ul>
        </HelpHint>
      </div>

      {error && <p className="llm-status-fail">{error}</p>}

      <h3 className="llm-tab-subhead">Individual features</h3>
      <table className="llm-call-sites-table">
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">Currently</th>
            <th scope="col">Route to</th>
          </tr>
        </thead>
        <tbody>
          {(simple ?? []).map((site) => {
            const draft = drafts[site.id] ?? draftFor(site);
            const provider = assignedProvider(site);
            return (
              <tr key={site.id} data-testid={`llm-call-site-row-${site.id}`}>
                <td>
                  <div className="llm-call-site-name">
                    <span>{site.label}</span>
                    <HelpHint
                      label={`What ${site.label} does`}
                      testId={`llm-call-site-help-${site.id}`}
                      align="left"
                    >
                      <p>{site.description}</p>
                      <p className="llm-help-foot">
                        One model call — can run through a direct API or a CLI.
                      </p>
                    </HelpHint>
                  </div>
                </td>
                <td>
                  {site.assignment ? (
                    <span className="llm-tag llm-tag-good" data-testid={`llm-call-site-assignment-${site.id}`}>
                      {providerLabel(site.assignment.provider_id)}
                      {site.assignment.model ? ` · ${site.assignment.model}` : ""}
                    </span>
                  ) : (
                    <span className="llm-tag llm-tag-quiet">Default</span>
                  )}
                  <BillingWarningBadge
                    provider={provider}
                    testId={`llm-call-site-billing-warning-${site.id}`}
                  />
                </td>
                <td>
                  <div className="llm-call-site-controls">
                    <select
                      className="llm-mode-select"
                      aria-label={`How ${site.label} connects`}
                      data-testid={`llm-call-site-mode-${site.id}`}
                      value={draft.mode}
                      onChange={(e) =>
                        // A provider valid under the old mode may not be in the new mode's list.
                        setDraft(site.id, { mode: e.target.value as CallSiteMode, providerId: "" })
                      }
                    >
                      <option value="api">API</option>
                      <option value="cli">CLI</option>
                    </select>
                    <select
                      aria-label={`Provider for ${site.label}`}
                      data-testid={`llm-call-site-provider-${site.id}`}
                      value={draft.providerId}
                      onChange={(e) => setDraft(site.id, { providerId: e.target.value })}
                    >
                      <option value="">Select a provider…</option>
                      {eligibleProviders(draft.mode).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Model for ${site.label}`}
                      data-testid={`llm-call-site-model-${site.id}`}
                      placeholder="model"
                      list={datalistId(draft.providerId)}
                      value={draft.model}
                      onChange={(e) => setDraft(site.id, { model: e.target.value })}
                    />
                    <button
                      type="button"
                      className="llm-button-ghost"
                      data-testid={`llm-call-site-fetch-models-${site.id}`}
                      disabled={!draft.providerId}
                      onClick={() => void loadModels(draft.providerId)}
                    >
                      Fetch models
                    </button>
                    {isDirty(site, draft) && (
                      <button
                        type="button"
                        className="llm-button-primary"
                        data-testid={`llm-call-site-assign-${site.id}`}
                        onClick={() => void assign(site)}
                      >
                        Apply
                      </button>
                    )}
                    {site.assignment && (
                      <button
                        type="button"
                        className="llm-button-ghost"
                        onClick={() => void clear(site)}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  {modelCatalogStatus(draft.providerId) && (
                    <p
                      className={
                        modelCatalogStatus(draft.providerId)!.isError
                          ? "llm-status-fail"
                          : "llm-field-hint"
                      }
                      data-testid={`llm-call-site-models-status-${site.id}`}
                    >
                      {modelCatalogStatus(draft.providerId)!.text}
                    </p>
                  )}
                  <BillingWarningBadge
                    provider={providers.find((p) => p.id === draft.providerId)}
                    testId={`llm-call-site-form-billing-warning-${site.id}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 className="llm-tab-subhead">Grouped by task type</h3>
      <table className="llm-call-sites-table llm-call-site-groups-table">
        <thead>
          <tr>
            <th scope="col">Task type</th>
            <th scope="col">Currently</th>
            <th scope="col">Route to</th>
          </tr>
        </thead>
        <tbody>
          {(groups ?? []).map((group) => {
            const draft = groupDrafts[group.id] ?? draftForGroup(group);
            const provider = assignedGroupProvider(group);
            return (
              <tr key={group.id} data-testid={`llm-call-site-group-row-${group.id}`}>
                <td>
                  <div className="llm-call-site-name">
                    <span>{group.label}</span>
                    <HelpHint
                      label={`What ${group.label} covers`}
                      testId={`llm-call-site-group-help-${group.id}`}
                      align="left"
                    >
                      <p>One provider choice applies to every skill below:</p>
                      <ul>
                        {group.members.map((member) => (
                          <li key={member.id}>
                            <strong>{member.label}</strong> — {member.description}
                          </li>
                        ))}
                      </ul>
                      <p className="llm-help-foot">
                        A whole agent session per skill — only a command-line provider can serve it.
                      </p>
                    </HelpHint>
                  </div>
                  <span className="llm-call-site-group-members">
                    {group.members.map((member) => member.label).join(", ")}
                  </span>
                </td>
                <td>
                  {group.assignment ? (
                    <span
                      className="llm-tag llm-tag-good"
                      data-testid={`llm-call-site-group-assignment-${group.id}`}
                    >
                      {providerLabel(group.assignment.provider_id)}
                      {group.assignment.model ? ` · ${group.assignment.model}` : ""}
                    </span>
                  ) : (
                    <span className="llm-tag llm-tag-quiet">Default</span>
                  )}
                  <BillingWarningBadge
                    provider={provider}
                    testId={`llm-call-site-group-billing-warning-${group.id}`}
                  />
                </td>
                <td>
                  <div className="llm-call-site-controls">
                    <select
                      aria-label={`Provider for ${group.label}`}
                      data-testid={`llm-call-site-group-provider-${group.id}`}
                      value={draft.providerId}
                      onChange={(e) => setGroupDraft(group.id, { providerId: e.target.value })}
                    >
                      <option value="">Select a provider…</option>
                      {cliProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Model for ${group.label}`}
                      data-testid={`llm-call-site-group-model-${group.id}`}
                      placeholder="model"
                      list={datalistId(draft.providerId)}
                      value={draft.model}
                      onChange={(e) => setGroupDraft(group.id, { model: e.target.value })}
                    />
                    <button
                      type="button"
                      className="llm-button-ghost"
                      data-testid={`llm-call-site-group-fetch-models-${group.id}`}
                      disabled={!draft.providerId}
                      onClick={() => void loadModels(draft.providerId)}
                    >
                      Fetch models
                    </button>
                    {isGroupDirty(group, draft) && (
                      <button
                        type="button"
                        className="llm-button-primary"
                        data-testid={`llm-call-site-group-assign-${group.id}`}
                        onClick={() => void assignGroup(group)}
                      >
                        Apply
                      </button>
                    )}
                    {group.assignment && (
                      <button
                        type="button"
                        className="llm-button-ghost"
                        onClick={() => void clearGroup(group)}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  {modelCatalogStatus(draft.providerId) && (
                    <p
                      className={
                        modelCatalogStatus(draft.providerId)!.isError
                          ? "llm-status-fail"
                          : "llm-field-hint"
                      }
                      data-testid={`llm-call-site-group-models-status-${group.id}`}
                    >
                      {modelCatalogStatus(draft.providerId)!.text}
                    </p>
                  )}
                  <BillingWarningBadge
                    provider={providers.find((p) => p.id === draft.providerId)}
                    testId={`llm-call-site-group-form-billing-warning-${group.id}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* One shared datalist per provider -- avoids duplicate-id elements when the same provider
       * is picked in more than one row (either table). */}
      {Object.entries(modelCatalog).map(([providerId, entry]) =>
        "loading" in entry ? null : (
          <datalist key={providerId} id={datalistId(providerId)}>
            {entry.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label ?? m.id}
              </option>
            ))}
          </datalist>
        )
      )}
    </div>
  );
}
