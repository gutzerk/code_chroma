using System.Text.Json;
using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Http;

/// <summary>Response and request helpers for routes that work on loosely typed JSON.</summary>
public static class Reply
{
    public static IResult Json(JsonNode? body, int status = 200) =>
        Results.Text(body?.ToJsonString() ?? "null", "application/json; charset=utf-8", statusCode: status);

    /// <summary>FastAPI's HTTPException shape: {"detail": ...}.</summary>
    public static IResult Error(int status, string detail) => Json(new JsonObject { ["detail"] = detail }, status);

    public static IResult Error(int status, JsonNode detail) => Json(new JsonObject { ["detail"] = detail }, status);

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
