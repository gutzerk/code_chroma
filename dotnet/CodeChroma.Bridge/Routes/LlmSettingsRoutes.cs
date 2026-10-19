using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Routes;

/// <summary>/llm/providers and /llm/call-sites: machine-local, not repo-scoped. API-provider connection tests are not ported.</summary>
public static class LlmSettingsRoutes
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/llm/providers", (ProviderStore providers) =>
            Reply.Json(new JsonArray(providers.Load().Values.Select(p => (JsonNode?)ProviderStore.Masked(p)).ToArray())));

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

        app.MapPost("/llm/providers/test", async (HttpRequest request) =>
        {
            var body = await Reply.LenientBody(request);
            var problems = ProviderStore.Validate(body);
            if (problems.Count > 0) return Reply.Error(400, string.Join("; ", problems));
            return Reply.Json(await ProviderTester.Run(null, ProviderStore.FromPayload("draft", ProviderStore.NormalizeKeys(body))));
        });

        app.MapPost("/llm/providers/{providerId}/test", async (string providerId, ProviderStore providers) =>
            providers.Find(providerId) is { } provider ? Reply.Json(await ProviderTester.Run(providerId, provider)) : Unknown(providerId));

        app.MapGet("/llm/providers/{providerId}/models", async (string providerId, ProviderStore providers) =>
            providers.Find(providerId) is { } provider ? Reply.Json(await ModelCatalog.Fetch(provider)) : Unknown(providerId));

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

    private static IResult Unknown(string providerId) => Reply.Error(404, $"unknown provider: '{providerId}'");

    private static IResult UnknownGroup(string groupId) => Reply.Error(404, $"unknown call site group: '{groupId}'");

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
