using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Routes;

/// <summary>/llm/providers, /llm/default, /llm/features and /llm/call-sites: machine-local, not repo-scoped. API-provider connection tests are not ported.</summary>
public static class LlmSettingsRoutes
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/llm/providers", (ProviderStore providers, CallSiteStore sites) =>
        {
            var used = FeatureRows(providers, sites).Select(r => Json.Str(r["effective"]!["provider_id"])).ToList();
            return Reply.Json(new JsonArray(providers.Load().Values.Select(p =>
            {
                var row = ProviderStore.Masked(p);
                var caps = ProviderStore.Capabilities(p);
                row["capabilities"] = new JsonObject { ["agents"] = caps.Agents, ["quick"] = caps.Quick };
                row["used_by"] = used.Count(id => id == Json.Str(p["id"]));
                return (JsonNode?)row;
            }).ToArray()));
        });

        app.MapGet("/llm/default", (CallSiteStore sites) => Reply.Json(new JsonObject { ["default"] = sites.Default() }));

        app.MapPut("/llm/default", async (HttpRequest request, ProviderStore providers, CallSiteStore sites, RuntimeEnvironment runtime) =>
        {
            try
            {
                var body = await Reply.LenientBody(request);
                await FillDefaultModels(body, providers, sites, runtime);
                sites.SaveDefault(body);
                return Reply.Json(new JsonObject { ["default"] = sites.Default() });
            }
            catch (ArgumentException error)
            {
                return Reply.Error(400, error.Message);
            }
        });

        app.MapDelete("/llm/default", (CallSiteStore sites) =>
        {
            sites.ClearDefault();
            return Reply.Json(new JsonObject { ["default"] = null });
        });

        app.MapGet("/llm/features", (ProviderStore providers, CallSiteStore sites) =>
            Reply.Json(new JsonObject { ["features"] = new JsonArray(FeatureRows(providers, sites).Select(r => (JsonNode?)r).ToArray()) }));

        app.MapPut("/llm/features/{featureId}", async (string featureId, HttpRequest request, ProviderStore providers, CallSiteStore sites, RuntimeEnvironment runtime) =>
        {
            if (LlmCatalog.Features.All(f => f.Id != featureId)) return UnknownFeature(featureId);
            var body = await Reply.LenientBody(request);
            try
            {
                if (Json.Bool(body["offline"]))
                {
                    sites.SaveOffline(featureId);
                    return Reply.Json(FeatureRow(featureId, providers, sites));
                }
                var payload = new JsonObject { ["provider_id"] = body["provider_id"]?.DeepClone(), ["model"] = body["model"]?.DeepClone() };
                if (Json.Str(payload["model"]) is not { } given || Json.IsBlank(given))
                {
                    var current = FeatureRow(featureId, providers, sites)["effective"]!;
                    var keep = Json.Str(current["provider_id"]) == Json.Str(payload["provider_id"]) ? Json.Str(current["model"]) : null;
                    payload["model"] = await PickModel(providers, Json.Str(payload["provider_id"]), keep, false, runtime);
                }
                if (LlmCatalog.Group(featureId) is not null) sites.SaveGroup(featureId, payload);
                else
                {
                    payload["mode"] = "api";
                    sites.SaveSimple(featureId, payload);
                }
                return Reply.Json(FeatureRow(featureId, providers, sites));
            }
            catch (ArgumentException error)
            {
                return Reply.Error(400, error.Message);
            }
        });

        app.MapDelete("/llm/features/{featureId}", (string featureId, ProviderStore providers, CallSiteStore sites) =>
        {
            if (LlmCatalog.Features.All(f => f.Id != featureId)) return UnknownFeature(featureId);
            if (LlmCatalog.Group(featureId) is not null) sites.ClearGroup(featureId);
            else sites.Clear(featureId);
            return Reply.Json(FeatureRow(featureId, providers, sites));
        });

        app.MapPost("/llm/providers/capabilities", async (HttpRequest request) =>
        {
            var body = await Reply.LenientBody(request);
            if (Json.Truthy(body["api_key_set"]) && !Json.Truthy(body["api_key"])) body["api_key"] = "<kept>";
            var caps = ProviderStore.Capabilities(ProviderStore.FromPayload("draft", ProviderStore.NormalizeKeys(body)));
            return Reply.Json(new JsonObject { ["capabilities"] = new JsonObject { ["agents"] = caps.Agents, ["quick"] = caps.Quick } });
        });

        app.MapPost("/llm/providers", async (HttpRequest request, ProviderStore providers) =>
        {
            try
            {
                return Reply.Json(ProviderStore.Masked(providers.Create(await Reply.LenientBody(request))), 201);
            }
            catch (ArgumentException error)
            {
                return Reply.Error(400, error.Message);
            }
        });

        app.MapPut("/llm/providers/{providerId}", async (string providerId, HttpRequest request, ProviderStore providers) =>
        {
            var body = await Reply.LenientBody(request);
            try
            {
                var updated = providers.Update(providerId, body);
                return updated is null ? Unknown(providerId) : Reply.Json(ProviderStore.Masked(updated));
            }
            catch (ArgumentException error)
            {
                return Reply.Error(400, error.Message);
            }
        });

        app.MapDelete("/llm/providers/{providerId}", (string providerId, ProviderStore providers, CallSiteStore sites) =>
        {
            if (providers.Find(providerId) is null) return Unknown(providerId);
            var blocking = sites.Blocking(providerId);
            if (blocking.Count > 0)
                return Reply.Error(409, new JsonObject
                {
                    ["error"] = "provider is still assigned to one or more call sites",
                    ["blocking_call_sites"] = new JsonArray(blocking.Select(b => (JsonNode?)b).ToArray()),
                });
            providers.Delete(providerId);
            return Results.StatusCode(204);
        });

        app.MapPost("/llm/providers/test", async (HttpRequest request, RuntimeEnvironment runtime) =>
        {
            var body = await Reply.LenientBody(request);
            var problems = ProviderStore.Validate(body);
            if (problems.Count > 0) return Reply.Error(400, string.Join("; ", problems));
            return Reply.Json(await ProviderTester.Run(null, ProviderStore.FromPayload("draft", ProviderStore.NormalizeKeys(body)), runtime));
        });

        app.MapPost("/llm/providers/{providerId}/test", async (string providerId, ProviderStore providers, RuntimeEnvironment runtime) =>
            providers.Find(providerId) is { } provider ? Reply.Json(await ProviderTester.Run(providerId, provider, runtime)) : Unknown(providerId));

        app.MapGet("/llm/cli/{adapter}/auth", async (string adapter, RuntimeEnvironment runtime) =>
            Reply.Json(new JsonObject { ["signed_in"] = await Task.Run(() => CliAuth.SignedIn(adapter, runtime)) }));

        app.MapGet("/llm/providers/{providerId}/models", async (string providerId, ProviderStore providers, RuntimeEnvironment runtime) =>
            providers.Find(providerId) is { } provider ? Reply.Json(await ModelCatalog.Fetch(provider, runtime)) : Unknown(providerId));

        app.MapGet("/llm/call-sites", (CallSiteStore sites, ProviderStore providers, UserPaths paths) =>
        {
            var assignments = sites.Assignments();
            var groupAssignments = sites.GroupAssignments();
            var loaded = providers.Load();
            var defaultCli = AssistantRoutes.EffectiveCli(paths);
            return Reply.Json(new JsonObject
            {
                ["simple"] = new JsonArray(LlmCatalog.CallSites.Where(s => s.Capability == "simple")
                    .Select(s => (JsonNode?)JoinedCallSite(s.Id, assignments.GetValueOrDefault(s.Id))).ToArray()),
                ["groups"] = new JsonArray(LlmCatalog.Groups.Where(g => !g.Hidden)
                    .Select(g => (JsonNode?)JoinedGroup(g.Id, groupAssignments.GetValueOrDefault(g.Id), loaded, defaultCli)).ToArray()),
            });
        });

        app.MapPut("/llm/call-sites/{callSiteId}", async (string callSiteId, HttpRequest request, CallSiteStore sites) =>
        {
            var site = LlmCatalog.CallSite(callSiteId);
            if (site is null) return Reply.Error(404, $"unknown call site: '{callSiteId}'");
            if (site.Capability == "agentic")
                return Reply.Error(400, $"'{callSiteId}' is agentic; assign its group via PUT /llm/call-site-groups/{{group_id}} instead");
            var body = await Reply.LenientBody(request);
            if (!Json.Truthy(body["provider_id"]))
            {
                sites.Clear(callSiteId);
                return Reply.Json(JoinedCallSite(callSiteId, null));
            }
            try
            {
                return Reply.Json(JoinedCallSite(callSiteId, sites.SaveSimple(callSiteId, body)));
            }
            catch (ArgumentException error)
            {
                return Reply.Error(400, error.Message);
            }
        });

        app.MapGet("/llm/call-site-groups/{groupId}", (string groupId, CallSiteStore sites, ProviderStore providers, UserPaths paths) =>
            LlmCatalog.Group(groupId) is null
                ? UnknownGroup(groupId)
                : Reply.Json(JoinedGroup(groupId, sites.GroupAssignments().GetValueOrDefault(groupId), providers.Load(), AssistantRoutes.EffectiveCli(paths))));

        app.MapPut("/llm/call-site-groups/{groupId}", async (string groupId, HttpRequest request, CallSiteStore sites, ProviderStore providers, UserPaths paths) =>
        {
            if (LlmCatalog.Group(groupId) is null) return UnknownGroup(groupId);
            var body = await Reply.LenientBody(request);
            var defaultCli = AssistantRoutes.EffectiveCli(paths);
            if (!Json.Truthy(body["provider_id"]))
            {
                sites.ClearGroup(groupId);
                return Reply.Json(JoinedGroup(groupId, null, providers.Load(), defaultCli));
            }
            try
            {
                var saved = sites.SaveGroup(groupId, body);
                return Reply.Json(JoinedGroup(groupId, saved, providers.Load(), defaultCli));
            }
            catch (ArgumentException error)
            {
                return Reply.Error(400, error.Message);
            }
        });
    }

    /// <summary>Keeps <paramref name="current"/> if the catalog lists it, else the second (or first) model; "" lets validation refuse.</summary>
    private static async Task<string> PickModel(ProviderStore providers, string? providerId, string? current, bool first, RuntimeEnvironment runtime)
    {
        if (providerId is null || providers.Find(providerId) is not { } provider) return "";
        var models = (await ModelCatalog.Fetch(provider, runtime))["models"] as JsonArray ?? [];
        var ids = models.Select(m => Json.Str(m?["id"])).Where(id => id is not null).Select(id => id!).ToList();
        return ModelCatalog.PickId(ids, current, first);
    }

    private static async Task FillDefaultModels(JsonObject body, ProviderStore providers, CallSiteStore sites, RuntimeEnvironment runtime)
    {
        if (Json.Str(body["model"]) is not { } model || Json.IsBlank(model))
        {
            var stored = sites.Default();
            var providerId = Json.Str(body["provider_id"]);
            var same = stored is not null && Json.Str(stored["provider_id"]) == providerId;
            body["model"] = await PickModel(providers, providerId, same ? Json.Str(stored!["model"]) : null, false, runtime);
        }
        foreach (var key in new[] { "quick_fallback", "agent_fallback" })
            if (body[key] is JsonObject fallback && !Json.Bool(fallback["offline"]) && (Json.Str(fallback["model"]) is not { } m || Json.IsBlank(m)))
                fallback["model"] = await PickModel(providers, Json.Str(fallback["provider_id"]), null, true, runtime);
    }

    private static IResult Unknown(string providerId) => Reply.Error(404, $"unknown provider: '{providerId}'");

    private static IResult UnknownGroup(string groupId) => Reply.Error(404, $"unknown call site group: '{groupId}'");

    private static IResult UnknownFeature(string featureId) => Reply.Error(404, $"unknown feature: '{featureId}'");

    private static JsonObject FeatureRow(string featureId, ProviderStore providers, CallSiteStore sites) =>
        FeatureRows(providers, sites).First(r => Json.Str(r["id"]) == featureId);

    /// <summary>One row per user-facing feature: its effective provider/model, where that came from, and which providers fit it.</summary>
    private static List<JsonObject> FeatureRows(ProviderStore providers, CallSiteStore sites)
    {
        var loaded = providers.Load();
        var assignments = sites.Assignments();
        var groupAssignments = sites.GroupAssignments();
        var rows = new List<JsonObject>();
        foreach (var feature in LlmCatalog.Features)
        {
            var overridden = LlmCatalog.Group(feature.Id) is not null
                ? groupAssignments.GetValueOrDefault(feature.Id)
                : assignments.GetValueOrDefault(feature.Id);
            var (effective, source) = overridden is not null
                ? (overridden, Json.Str(overridden["mode"]) == "offline" ? "offline" : "custom")
                : sites.ResolveDefault(feature.Needs);
            var providerId = Json.NonEmptyStr(effective?["provider_id"]);
            var provider = providerId is null ? null : loaded.GetValueOrDefault(providerId);
            rows.Add(new JsonObject
            {
                ["id"] = feature.Id,
                ["label"] = feature.Label,
                ["description"] = feature.Description,
                ["needs"] = feature.Needs,
                ["effective"] = new JsonObject
                {
                    ["provider_id"] = providerId,
                    ["provider_name"] = provider is null ? null : Json.Str(provider["label"]),
                    ["model"] = Json.NonEmptyStr(effective?["model"]),
                },
                ["source"] = source,
                ["compatible_provider_ids"] = new JsonArray(loaded
                    .Where(kv => ProviderStore.Capabilities(kv.Value).Can(feature.Needs))
                    .Select(kv => (JsonNode?)kv.Key).ToArray()),
            });
        }
        return rows;
    }

    private static JsonObject JoinedCallSite(string id, JsonObject? assignment)
    {
        var site = LlmCatalog.CallSite(id)!;
        return new JsonObject
        {
            ["id"] = site.Id, ["label"] = site.Label, ["capability"] = site.Capability, ["description"] = site.Description,
            ["assignment"] = assignment?.DeepClone(),
        };
    }

    private static JsonObject JoinedGroup(string id, JsonObject? assignment, IReadOnlyDictionary<string, JsonObject> providers, string defaultCli)
    {
        var group = LlmCatalog.Group(id)!;
        string? binary = defaultCli;
        if (assignment is not null)
            binary = providers.TryGetValue(Json.Str(assignment["provider_id"]) ?? "", out var provider) ? Json.Str(provider["adapter"]) : null;
        return new JsonObject
        {
            ["id"] = group.Id,
            ["label"] = group.Label,
            ["members"] = new JsonArray(group.Members.Select(m =>
            {
                var member = LlmCatalog.CallSite(m)!;
                return (JsonNode?)new JsonObject { ["id"] = member.Id, ["label"] = member.Label, ["description"] = member.Description };
            }).ToArray()),
            ["assignment"] = assignment is null ? null : new JsonObject { ["provider_id"] = assignment["provider_id"]!.DeepClone(), ["model"] = assignment["model"]!.DeepClone() },
            ["cli_available"] = !string.IsNullOrEmpty(binary) && CliLocator.Find(binary) is not null,
        };
    }
}
