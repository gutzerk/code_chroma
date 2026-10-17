using System.Reflection;
using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Stores;

public sealed record CallSiteInfo(string Id, string Label, string Capability, string Description);

public sealed record GroupInfo(string Id, string Label, IReadOnlyList<string> Members, bool Hidden);

/// <summary>The code-defined call sites, groups, adapters and transports, embedded from llm_catalog.json (dumped from Python).</summary>
public static class LlmCatalog
{
    public static JsonObject Data { get; } = Load();

    public static IReadOnlyList<CallSiteInfo> CallSites { get; } = Data["call_sites"]!.AsArray()
        .Select(n => new CallSiteInfo(Str(n!, "id"), Str(n!, "label"), Str(n!, "capability"), Str(n!, "description"))).ToList();

    public static IReadOnlyList<GroupInfo> Groups { get; } = Data["groups"]!.AsArray()
        .Select(n => new GroupInfo(Str(n!, "id"), Str(n!, "label"),
            n!["members"]!.AsArray().Select(m => m!.GetValue<string>()).ToList(), n["hidden"]!.GetValue<bool>())).ToList();

    public static IReadOnlyList<string> Strings(string key) => Data[key]!.AsArray().Select(n => n!.GetValue<string>()).ToList();

    public static IReadOnlyList<string> Adapters { get; } = Strings("adapters");

    public static IReadOnlyList<string> Transports { get; } = Strings("transports");

    public static IReadOnlyList<string> Kinds { get; } = Strings("kinds");

    public static CallSiteInfo? CallSite(string id) => CallSites.FirstOrDefault(c => c.Id == id);

    public static GroupInfo? Group(string id) => Groups.FirstOrDefault(g => g.Id == id);

    /// <summary>The group owning an agentic call site; null for a simple or unknown one.</summary>
    public static string? GroupOf(string callSiteId) => Groups.FirstOrDefault(g => g.Members.Contains(callSiteId))?.Id;

    private static string Str(JsonNode node, string key) => node[key]!.GetValue<string>();

    private static JsonObject Load()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("llm_catalog.json")
            ?? throw new InvalidOperationException("llm_catalog.json is not embedded");
        return JsonNode.Parse(stream)!.AsObject();
    }
}
