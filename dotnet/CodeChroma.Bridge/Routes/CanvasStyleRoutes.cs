using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Routes;

/// <summary>GET/PUT/DELETE /canvas-style: the canvas look is machine-local, so every project's bridge shares one file.</summary>
public static partial class CanvasStyleRoutes
{
    private static readonly string[] Textures = ["none", "dots", "lines"];

    [GeneratedRegex("^#[0-9a-f]{6}$")]
    private static partial Regex Hex();

    public static void Map(WebApplication app)
    {
        app.MapGet("/canvas-style", (UserPaths paths) => Reply.Json(JsonFile.Load(paths.CanvasStyle) as JsonObject));

        app.MapPut("/canvas-style", async (HttpRequest request, UserPaths paths) =>
        {
            var body = await Reply.LenientBody(request);
            if (Validated(body) is not { } style) return Reply.Error(400, "invalid canvas style");
            JsonFile.Write(paths.CanvasStyle, style);
            return Reply.Json(style);
        });

        app.MapDelete("/canvas-style", (UserPaths paths) =>
        {
            JsonFile.Locked(() =>
            {
                if (File.Exists(paths.CanvasStyle)) File.Delete(paths.CanvasStyle);
                return true;
            });
            return Reply.Json(null);
        });
    }

    private static JsonObject? Validated(JsonObject body)
    {
        var bg = Json.Str(body["bg"])?.ToLowerInvariant();
        var color = Json.Str(body["textureColor"])?.ToLowerInvariant();
        var texture = Json.Str(body["texture"]);
        if (bg is null || color is null || texture is null || !Hex().IsMatch(bg) || !Hex().IsMatch(color) || !Textures.Contains(texture)) return null;
        if (Number(body["opacity"], 0, 70) is not { } opacity || Number(body["spacing"], 12, 64) is not { } spacing) return null;
        return new JsonObject { ["bg"] = bg, ["texture"] = texture, ["textureColor"] = color, ["opacity"] = opacity, ["spacing"] = spacing };
    }

    private static double? Number(JsonNode? node, double min, double max) =>
        node is JsonValue v && v.TryGetValue<double>(out var n) && n >= min && n <= max ? n : null;
}
