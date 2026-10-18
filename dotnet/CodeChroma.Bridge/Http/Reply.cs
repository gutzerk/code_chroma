using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Http;

/// <summary>Response and request helpers for routes that work on loosely typed JSON.</summary>
public static class Reply
{
    public static IResult Json(JsonNode? body, int status = 200) =>
        Results.Text(body?.ToJsonString() ?? "null", "application/json; charset=utf-8", statusCode: status);

    /// <summary>FastAPI's HTTPException shape: {"detail": ...}.</summary>
    public static IResult Error(int status, string detail) => Json(new JsonObject { ["detail"] = detail }, status);

    public static IResult Error(int status, JsonNode detail) => Json(new JsonObject { ["detail"] = detail }, status);

    /// <summary>Runs a route body, turning a BridgeException into its HTTP error reply.</summary>
    public static IResult Guard(Func<IResult> body)
    {
        try { return body(); }
        catch (BridgeException error) { return Error(error.Status, error.Detail); }
    }

    /// <summary>Like Guard, but runs a blocking (git/gh) body on the thread pool.</summary>
    public static Task<IResult> GuardBlocking(Func<IResult> body) => GuardAsync(() => Task.Run(body));

    public static async Task<IResult> GuardAsync(Func<Task<IResult>> body)
    {
        try { return await body(); }
        catch (BridgeException error) { return Error(error.Status, error.Detail); }
    }

    /// <summary>The request's JSON object, or an empty one for an empty, malformed or non-object body.</summary>
    public static async Task<JsonObject> LenientBody(HttpRequest request)
    {
        try
        {
            return await JsonNode.ParseAsync(request.Body) as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }
}
