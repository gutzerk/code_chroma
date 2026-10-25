using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Stores;

/// <summary>Machine-local provider connections (llm-providers.json); entries are JsonObjects with the Python field set.</summary>
public sealed class ProviderStore(UserPaths paths)
{
    private static readonly string[] Modes = ["cli", "api"];

    public IReadOnlyDictionary<string, JsonObject> Load()
    {
        var result = new Dictionary<string, JsonObject>();
        if (JsonFile.LoadObject(paths.Providers)["providers"] is JsonObject raw)
            foreach (var (id, entry) in raw)
                if (entry is JsonObject fields) result[id] = FromPayload(id, fields);
        return result;
    }

    public JsonObject? Find(string id) => Load().GetValueOrDefault(id);

    public static JsonObject Masked(JsonObject provider) => new()
    {
        ["id"] = provider["id"]!.DeepClone(),
        ["label"] = provider["label"]!.DeepClone(),
        ["kind"] = provider["kind"]!.DeepClone(),
        ["adapter"] = provider["adapter"]?.DeepClone(),
        ["transport"] = provider["transport"]?.DeepClone(),
        ["base_url"] = provider["base_url"]?.DeepClone(),
        ["api_key_set"] = Json.Truthy(provider["api_key"]),
        ["api_key_path"] = provider["api_key_path"]?.DeepClone(),
        ["is_local"] = provider["is_local"]!.DeepClone(),
        ["test_model"] = provider["test_model"]?.DeepClone(),
        ["verify_ssl"] = provider["verify_ssl"]!.DeepClone(),
    };

    public static List<string> Validate(JsonObject payload)
    {
        var problems = new List<string>();
        if (Json.Str(payload["label"]) is not { } label || Json.IsBlank(label))
            problems.Add("label must be a non-empty string");
        var kind = Json.Str(payload["kind"]);
        if (kind is null || !LlmCatalog.Kinds.Contains(kind))
        {
            problems.Add($"kind must be one of {PyTuple(LlmCatalog.Kinds)}");
            return problems;
        }
        var baseUrl = payload["base_url"];
        var apiKey = payload["api_key"];
        var apiKeyPath = payload["api_key_path"];
        if (kind == "cli")
        {
            var adapter = Json.Str(payload["adapter"]);
            if (adapter is null || !LlmCatalog.Adapters.Contains(adapter))
                problems.Add($"adapter must be one of {PyList(LlmCatalog.Adapters.Order(StringComparer.Ordinal))}");
            if (adapter != "claude" && (Json.Truthy(baseUrl) || Json.Truthy(apiKey) || Json.Truthy(apiKeyPath)))
                problems.Add("base_url/api_key/api_key_path are only valid for the claude adapter");
            if (baseUrl is not null && (Json.Str(baseUrl) is not { } b || Json.IsBlank(b)))
                problems.Add("base_url must be a non-empty string when given");
            if (Json.Truthy(apiKey) && Json.Truthy(apiKeyPath))
                problems.Add("provide an api_key OR an api_key_path, not both");
            return problems;
        }
        var transport = Json.Str(payload["transport"]);
        if (transport is null || !LlmCatalog.Transports.Contains(transport))
            problems.Add($"transport must be one of {PyTuple(LlmCatalog.Transports)}");
        if (transport == "openai-compatible" && (Json.Str(baseUrl) is not { } url || Json.IsBlank(url)))
            problems.Add("base_url is required for an openai-compatible transport");
        if (payload["test_model"] is { } testModel && (Json.Str(testModel) is not { } m || Json.IsBlank(m)))
            problems.Add("test_model must be a non-empty string when given");
        var isLocal = payload.ContainsKey("is_local") ? payload["is_local"] : JsonValue.Create(false);
        if (Json.Truthy(apiKey) && Json.Truthy(apiKeyPath))
            problems.Add("provide an api_key OR an api_key_path, not both");
        if (!Json.Truthy(isLocal) && !Json.Truthy(apiKey) && !Json.Truthy(apiKeyPath))
            problems.Add("a non-local api provider needs an api_key or api_key_path");
        return problems;
    }

    public static JsonObject FromPayload(string id, JsonObject payload)
    {
        var kind = Json.Str(payload["kind"]);
        return new JsonObject
        {
            ["id"] = id,
            ["label"] = Json.Str(payload["label"]) ?? "",
            ["kind"] = kind is not null && LlmCatalog.Kinds.Contains(kind) ? kind : "api",
            ["adapter"] = Json.Str(payload["adapter"]),
            ["transport"] = Json.Str(payload["transport"]),
            ["base_url"] = Json.Str(payload["base_url"]),
            ["api_key"] = Json.Str(payload["api_key"]),
            ["api_key_path"] = Json.Str(payload["api_key_path"]),
            ["is_local"] = payload.ContainsKey("is_local") && Json.Truthy(payload["is_local"]),
            ["test_model"] = Json.Str(payload["test_model"]),
            ["verify_ssl"] = !payload.ContainsKey("verify_ssl") || Json.Truthy(payload["verify_ssl"]),
        };
    }

    /// <summary>Empty-string keys and paths mean "clear".</summary>
    public static JsonObject NormalizeKeys(JsonObject payload)
    {
        var data = (JsonObject)payload.DeepClone();
        if (Json.Str(data["api_key"]) == "") data["api_key"] = null;
        if (Json.Str(data["api_key_path"]) == "") data["api_key_path"] = null;
        return data;
    }

    public JsonObject Create(JsonObject payload)
    {
        var problems = Validate(payload);
        if (problems.Count > 0) throw new ArgumentException(string.Join("; ", problems));
        return JsonFile.Locked(() =>
        {
            var providers = Load().ToDictionary(kv => kv.Key, kv => kv.Value);
            var id = Guid.NewGuid().ToString("N")[..12];
            var provider = FromPayload(id, NormalizeKeys(payload));
            providers[id] = provider;
            Persist(providers);
            return provider;
        });
    }

    public JsonObject? Update(string id, JsonObject payload)
    {
        return JsonFile.Locked(() =>
        {
            var providers = Load().ToDictionary(kv => kv.Key, kv => kv.Value);
            if (!providers.TryGetValue(id, out var existing)) return null;
            var merged = Masked(existing);
            foreach (var (key, value) in NormalizeKeys(payload)) merged[key] = value?.DeepClone();
            merged.Remove("id");
            merged.Remove("api_key_set");
            if (payload.ContainsKey("api_key_set") && !payload.ContainsKey("api_key")) merged["api_key"] = existing["api_key"]?.DeepClone();
            var problems = Validate(merged);
            if (problems.Count > 0) throw new ArgumentException(string.Join("; ", problems));
            var updated = FromPayload(id, merged);
            providers[id] = updated;
            Persist(providers);
            return updated;
        });
    }

    public bool Delete(string id) => JsonFile.Locked(() =>
    {
        var providers = Load().ToDictionary(kv => kv.Key, kv => kv.Value);
        if (!providers.Remove(id)) return false;
        Persist(providers);
        return true;
    });

    private void Persist(Dictionary<string, JsonObject> providers)
    {
        var entries = new JsonObject();
        foreach (var (id, provider) in providers)
        {
            var entry = (JsonObject)provider.DeepClone();
            entry.Remove("id");
            entries[id] = entry;
        }
        JsonFile.Write(paths.Providers, new JsonObject { ["schema_version"] = 1, ["providers"] = entries });
    }

    public static string PyTuple(IEnumerable<string> items) => "(" + string.Join(", ", items.Select(i => $"'{i}'")) + ")";

    public static string PyList(IEnumerable<string> items) => "[" + string.Join(", ", items.Select(i => $"'{i}'")) + "]";

    public static bool IsMode(string? mode) => mode is not null && Modes.Contains(mode);

    /// <summary>What a connection can drive: a CLI agent run (Agents) and/or a one-shot call (Quick); derived, never stored.</summary>
    public static ProviderCapabilities Capabilities(JsonObject provider)
    {
        var hasKey = Json.Truthy(provider["api_key"]) || Json.Truthy(provider["api_key_path"]);
        if (Json.Str(provider["kind"]) == "cli") return new(true, Json.Str(provider["adapter"]) == "claude" && hasKey);
        if (Json.Str(provider["transport"]) == "anthropic") return new(hasKey, hasKey);
        return new(false, true);
    }
}

public sealed record ProviderCapabilities(bool Agents, bool Quick)
{
    public bool Can(string needs) => needs == "agents" ? Agents : Quick;
}

/// <summary>Per-call-site assignments (llm-call-site-settings.json); unassigned sites have no row.</summary>
public sealed class CallSiteStore(UserPaths paths, ProviderStore providers)
{
    public Dictionary<string, JsonObject> Assignments()
    {
        var result = new Dictionary<string, JsonObject>();
        if (JsonFile.LoadObject(paths.CallSites)["assignments"] is JsonObject raw)
            foreach (var (id, entry) in raw)
                if (entry is JsonObject e && Json.IsString(e["provider_id"]) && Json.IsString(e["model"]) && Json.IsString(e["mode"]))
                    result[id] = new JsonObject { ["provider_id"] = e["provider_id"]!.DeepClone(), ["model"] = e["model"]!.DeepClone(), ["mode"] = e["mode"]!.DeepClone() };
        return result;
    }

    public Dictionary<string, JsonObject> GroupAssignments()
    {
        var result = new Dictionary<string, JsonObject>();
        if (JsonFile.LoadObject(paths.CallSites)["group_assignments"] is JsonObject raw)
            foreach (var (id, entry) in raw)
                if (LlmCatalog.Group(id) is not null && entry is JsonObject e && Json.IsString(e["provider_id"]) && Json.IsString(e["model"]))
                    result[id] = new JsonObject { ["provider_id"] = e["provider_id"]!.DeepClone(), ["model"] = e["model"]!.DeepClone() };
        return result;
    }

    public List<string> ValidateSimple(string callSiteId, JsonObject payload)
    {
        var problems = new List<string>();
        var providerId = Json.Str(payload["provider_id"]);
        var provider = providerId is null ? null : providers.Find(providerId);
        if (provider is null)
        {
            problems.Add("provider_id must reference an existing provider");
            return problems;
        }
        if (Json.Str(payload["model"]) is not { } model || Json.IsBlank(model))
            problems.Add("model must be a non-empty string");
        var mode = Json.Str(payload["mode"]);
        if (!ProviderStore.IsMode(mode))
        {
            problems.Add($"mode must be one of {ProviderStore.PyTuple(["cli", "api"])}");
            return problems;
        }
        var kind = Json.Str(provider["kind"]);
        if (mode == "api" && kind != "api") problems.Add("mode=api requires a provider of kind=api");
        if (mode == "cli" && kind != "cli") problems.Add("mode=cli requires a provider of kind=cli");
        return problems;
    }

    public List<string> ValidateGroup(JsonObject payload)
    {
        var problems = new List<string>();
        var providerId = Json.Str(payload["provider_id"]);
        var provider = providerId is null ? null : providers.Find(providerId);
        if (provider is null)
        {
            problems.Add("provider_id must reference an existing provider");
            return problems;
        }
        if (!ProviderStore.Capabilities(provider).Agents) problems.Add("an agentic group needs a provider that can drive a CLI agent");
        if (Json.Str(payload["model"]) is not { } model || Json.IsBlank(model))
            problems.Add("model must be a non-empty string");
        return problems;
    }

    public JsonObject SaveSimple(string callSiteId, JsonObject payload)
    {
        var problems = ValidateSimple(callSiteId, payload);
        if (problems.Count > 0) throw new ArgumentException(string.Join("; ", problems));
        return JsonFile.Locked(() =>
        {
            var assignments = Assignments();
            var assignment = new JsonObject { ["provider_id"] = payload["provider_id"]!.DeepClone(), ["model"] = payload["model"]!.DeepClone(), ["mode"] = payload["mode"]!.DeepClone() };
            assignments[callSiteId] = assignment;
            Persist(assignments, GroupAssignments(), Default());
            return assignment;
        });
    }

    public JsonObject SaveGroup(string groupId, JsonObject payload)
    {
        var problems = ValidateGroup(payload);
        if (problems.Count > 0) throw new ArgumentException(string.Join("; ", problems));
        return JsonFile.Locked(() =>
        {
            var groups = GroupAssignments();
            var assignment = new JsonObject { ["provider_id"] = payload["provider_id"]!.DeepClone(), ["model"] = payload["model"]!.DeepClone() };
            groups[groupId] = assignment;
            Persist(Assignments(), groups, Default());
            return assignment;
        });
    }

    public void Clear(string callSiteId) => JsonFile.Locked(() =>
    {
        var assignments = Assignments();
        if (assignments.Remove(callSiteId)) Persist(assignments, GroupAssignments(), Default());
        return 0;
    });

    public void ClearGroup(string groupId) => JsonFile.Locked(() =>
    {
        var groups = GroupAssignments();
        if (groups.Remove(groupId)) Persist(Assignments(), groups, Default());
        return 0;
    });

    /// <summary>The stored default model ({provider_id, model, quick_fallback, agent_fallback}), or null when none is set.</summary>
    public JsonObject? Default()
    {
        if (JsonFile.LoadObject(paths.CallSites)["default"] is not JsonObject raw
            || !Json.IsString(raw["provider_id"]) || !Json.IsString(raw["model"])) return null;
        return new JsonObject
        {
            ["provider_id"] = raw["provider_id"]!.DeepClone(),
            ["model"] = raw["model"]!.DeepClone(),
            ["quick_fallback"] = FallbackFrom(raw["quick_fallback"]),
            ["agent_fallback"] = FallbackFrom(raw["agent_fallback"]),
        };
    }

    private static JsonObject? FallbackFrom(JsonNode? raw)
    {
        if (raw is not JsonObject fallback) return null;
        if (Json.Bool(fallback["offline"])) return new JsonObject { ["offline"] = true };
        return Json.IsString(fallback["provider_id"]) && Json.IsString(fallback["model"])
            ? new JsonObject { ["provider_id"] = fallback["provider_id"]!.DeepClone(), ["model"] = fallback["model"]!.DeepClone() }
            : null;
    }

    public List<string> ValidateDefault(JsonObject payload)
    {
        var providerId = Json.Str(payload["provider_id"]);
        if ((providerId is null ? null : providers.Find(providerId)) is null) return ["provider_id must reference an existing provider"];
        var problems = new List<string>();
        if (Json.Str(payload["model"]) is not { } model || Json.IsBlank(model))
            problems.Add("model must be a non-empty string");
        problems.AddRange(ValidateFallback(payload["quick_fallback"], "quick", "quick_fallback"));
        problems.AddRange(ValidateFallback(payload["agent_fallback"], "agents", "agent_fallback"));
        return problems;
    }

    private List<string> ValidateFallback(JsonNode? raw, string needs, string name)
    {
        if (raw is null) return [];
        if (raw is not JsonObject fallback) return [$"{name} must be an object"];
        if (Json.Bool(fallback["offline"])) return needs == "agents" ? [$"{name} cannot be offline"] : [];
        var providerId = Json.Str(fallback["provider_id"]);
        if ((providerId is null ? null : providers.Find(providerId)) is not { } provider)
            return [$"{name}.provider_id must reference an existing provider"];
        var problems = new List<string>();
        if (!ProviderStore.Capabilities(provider).Can(needs)) problems.Add($"{name} must reference a provider that can run {needs} work");
        if (Json.Str(fallback["model"]) is not { } model || Json.IsBlank(model))
            problems.Add($"{name}.model must be a non-empty string");
        return problems;
    }

    public JsonObject SaveDefault(JsonObject payload)
    {
        var problems = ValidateDefault(payload);
        if (problems.Count > 0) throw new ArgumentException(string.Join("; ", problems));
        var saved = new JsonObject
        {
            ["provider_id"] = payload["provider_id"]!.DeepClone(),
            ["model"] = payload["model"]!.DeepClone(),
            ["quick_fallback"] = FallbackFrom(payload["quick_fallback"]),
            ["agent_fallback"] = FallbackFrom(payload["agent_fallback"]),
        };
        return JsonFile.Locked(() =>
        {
            Persist(Assignments(), GroupAssignments(), saved);
            return saved;
        });
    }

    public void ClearDefault() => JsonFile.Locked(() =>
    {
        if (Default() is not null) Persist(Assignments(), GroupAssignments(), null);
        return 0;
    });

    /// <summary>The effective assignment: the group's (agentic) or the site's own (simple) override, else the default or its fallback.</summary>
    public JsonObject? EffectiveAssignment(string callSiteId)
    {
        if (LlmCatalog.GroupOf(callSiteId) is { } group)
        {
            var assigned = GroupAssignments().GetValueOrDefault(group);
            return assigned is null ? ResolveDefault("agents").Assignment : new JsonObject
            {
                ["provider_id"] = assigned["provider_id"]!.DeepClone(), ["model"] = assigned["model"]!.DeepClone(), ["mode"] = "cli",
            };
        }
        if (Assignments().GetValueOrDefault(callSiteId) is { } own) return own;
        return LlmCatalog.CallSite(callSiteId) is null ? null : ResolveDefault("quick").Assignment;
    }

    /// <summary>The default (or its fallback) as {provider_id, model, mode} for agents/quick work, with its source label.</summary>
    public (JsonObject? Assignment, string Source) ResolveDefault(string needs)
    {
        if (Default() is not { } stored) return (null, "legacy");
        var mode = needs == "agents" ? "cli" : "api";
        var providerId = Json.Str(stored["provider_id"])!;
        if (providers.Find(providerId) is { } provider && ProviderStore.Capabilities(provider).Can(needs))
            return (Synthesized(providerId, Json.Str(stored["model"])!, mode), "default");
        if (stored[needs == "agents" ? "agent_fallback" : "quick_fallback"] is not JsonObject fallback) return (null, "legacy");
        if (Json.Bool(fallback["offline"])) return (Synthesized("", "", "offline"), "offline");
        var fallbackId = Json.Str(fallback["provider_id"]) ?? "";
        if (providers.Find(fallbackId) is { } backup && ProviderStore.Capabilities(backup).Can(needs))
            return (Synthesized(fallbackId, Json.Str(fallback["model"])!, mode), "fallback");
        return (null, "legacy");
    }

    private static JsonObject Synthesized(string providerId, string model, string mode) =>
        new() { ["provider_id"] = providerId, ["model"] = model, ["mode"] = mode };

    /// <summary>Every call site still assigned to the provider (plus "default"), which is what a provider delete blocks on.</summary>
    public List<string> Blocking(string providerId)
    {
        var simple = Assignments().Where(kv => Json.Str(kv.Value["provider_id"]) == providerId).Select(kv => kv.Key);
        var grouped = GroupAssignments().Where(kv => Json.Str(kv.Value["provider_id"]) == providerId)
            .SelectMany(kv => LlmCatalog.Group(kv.Key)!.Members);
        var stored = Default();
        var usesDefault = stored is not null && (Json.Str(stored["provider_id"]) == providerId
            || new[] { "quick_fallback", "agent_fallback" }.Any(k => stored[k] is JsonObject f && Json.Str(f["provider_id"]) == providerId));
        return [.. simple, .. grouped, .. usesDefault ? new[] { "default" } : []];
    }

    private void Persist(Dictionary<string, JsonObject> assignments, Dictionary<string, JsonObject> groups, JsonObject? defaultModel)
    {
        var simple = new JsonObject();
        foreach (var (id, a) in assignments) simple[id] = a.DeepClone();
        var grouped = new JsonObject();
        foreach (var (id, a) in groups) grouped[id] = a.DeepClone();
        var data = new JsonObject { ["schema_version"] = 1 };
        if (defaultModel is not null) data["default"] = defaultModel.DeepClone();
        data["assignments"] = simple;
        data["group_assignments"] = grouped;
        JsonFile.Write(paths.CallSites, data);
    }
}
