using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;
using Microsoft.Extensions.DependencyInjection;

namespace CodeChroma.Bridge.Tests.Questions;

/// <summary>Builders shared by the question tests.</summary>
internal static class QuestionTestKit
{
    public static QuestionOption Option(string id, int? rank = null, string? title = null, string description = "d", string pro = "p", string con = "c", string why = "w", string? diagramRef = null) =>
        new() { Id = id, Title = title ?? $"Option {id}", Description = description, Pro = pro, Con = con, Why = why, Rank = rank, DiagramRef = diagramRef };

    public static List<QuestionOption> Two() =>
    [
        Option("a", 1, "Modular monolith", "one deploy", "simple", "coupled", "fits the team"),
        Option("b", 2, "Microservices", "many deploys", "isolated", "ops cost", "scales apart"),
    ];

    public static AskRequest Request(List<QuestionOption>? options = null, string question = "How to structure checkout?", string? sessionId = null, string kind = "choices", bool allowCustom = true, bool allowSkip = true, int? total = null) =>
        new() { Question = question, Options = options ?? Two(), SessionId = sessionId, Kind = kind, AllowCustom = allowCustom, AllowSkip = allowSkip, Total = total };

    public static Workspace Main(BridgeHost host) => host.Factory.Services.GetRequiredService<WorkspaceRegistry>().Get("main");

    public static QuestionMcp Mcp(BridgeHost host) => host.Factory.Services.GetRequiredService<QuestionMcp>();

    /// <summary>Opens a question element directly and returns its question id.</summary>
    public static string Open(BridgeHost host, AskRequest request)
    {
        var id = Guid.NewGuid().ToString("N");
        QuestionStore.OpenQuestion(Main(host), request, id);
        return id;
    }

    public static StringContent JsonBody(JsonNode body) => new(body.ToJsonString(), Encoding.UTF8, "application/json");

    public static async Task<JsonObject> Body(HttpResponseMessage response) => (JsonObject)JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
}
