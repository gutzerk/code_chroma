using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Skills;

/// <summary>Renders one stream-json event into progress lines; only whitelisted shapes show, the rest is noise.</summary>
public static class SkillOutput
{
    private const int MaxArg = 100;
    private const int MaxError = 100;
    private const int MaxThink = 200;
    private static readonly string[] ArgKeys = ["file_path", "pattern", "command", "path", "url", "description"];
    private static readonly char[] LineBreaks = [.. new int[] { 0x0A, 0x0D, 0x0B, 0x0C, 0x1C, 0x1D, 0x1E, 0x85, 0x2028, 0x2029 }.Select(c => (char)c)];

    public static IReadOnlyList<string> Render(JsonNode? node, string repoRoot)
    {
        if (node is not JsonObject evt) return [];
        return Json.Str(evt["type"]) switch
        {
            "assistant" => RenderAssistant(evt, repoRoot),
            "user" => RenderUser(evt),
            "result" => RenderResult(evt),
            _ => [],
        };
    }

    private static List<string> RenderAssistant(JsonObject evt, string repoRoot)
    {
        var lines = new List<string>();
        foreach (var block in ContentBlocks(evt))
            switch (Json.Str(block["type"]))
            {
                case "text":
                    lines.AddRange(TextLines(block["text"]));
                    break;
                case "tool_use":
                    lines.Add(ToolLine(block, repoRoot));
                    break;
                case "thinking":
                    if (Json.Str(block["thinking"]) is { } text && !Json.IsBlank(text)) lines.Add(Flatten(text, MaxThink));
                    break;
            }
        return lines;
    }

    private static List<string> RenderUser(JsonObject evt)
    {
        var lines = new List<string>();
        foreach (var block in ContentBlocks(evt))
            if (Json.Str(block["type"]) == "tool_result" && Json.Truthy(block["is_error"]))
                lines.Add($"  ↳ error: {Flatten(ResultText(block), MaxError)}");
        return lines;
    }

    private static List<string> RenderResult(JsonObject evt)
    {
        if (Json.Truthy(evt["is_error"]))
        {
            var message = Json.Str(evt["result"]);
            var text = message is not null && !Json.IsBlank(message) ? Flatten(message, MaxError) : "";
            var subtype = Json.Str(evt["subtype"]);
            return [$"✗ {(text.Length > 0 ? text : !string.IsNullOrEmpty(subtype) ? subtype : "failed")}"];
        }
        if (evt["duration_api_ms"] is JsonValue v && v.GetValueKind() == JsonValueKind.Number)
            return [$"✓ done in {(long)Math.Round(v.GetValue<double>() / 1000, MidpointRounding.ToEven)}s"];
        return ["✓ done"];
    }

    private static List<JsonObject> ContentBlocks(JsonObject evt)
    {
        var content = (evt["message"] as JsonObject)?["content"];
        if (Json.Str(content) is { } text) return [new JsonObject { ["type"] = "text", ["text"] = text }];
        return content is JsonArray array ? array.OfType<JsonObject>().ToList() : [];
    }

    /// <summary>Kept multi-line: an agent's own prose is the one place line breaks carry meaning.</summary>
    public static List<string> TextLines(JsonNode? text) =>
        Json.Str(text) is { } s
            ? s.Trim().Split(LineBreaks).Select(l => l.TrimEnd()).Where(l => l.Length > 0).ToList()
            : [];

    private static string ToolLine(JsonObject block, string repoRoot)
    {
        var name = Json.Str(block["name"]) is { Length: > 0 } n ? n : "tool";
        var arg = block["input"] is JsonObject input ? ToolArg(input, repoRoot) : "";
        return arg.Length > 0 ? $"⏺ {name}({arg})" : $"⏺ {name}";
    }

    private static string ToolArg(JsonObject input, string repoRoot)
    {
        foreach (var key in ArgKeys)
        {
            if (Json.Str(input[key]) is not { } value || Json.IsBlank(value)) continue;
            return Flatten(key == "file_path" ? Relativize(value, repoRoot) : value, MaxArg);
        }
        return "";
    }

    private static string Relativize(string value, string repoRoot)
    {
        var path = value.Replace('\\', '/');
        var root = repoRoot.Replace('\\', '/').TrimEnd('/');
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (string.Equals(path, root, comparison)) return ".";
        return path.StartsWith(root + "/", comparison) ? path[(root.Length + 1)..] : value;
    }

    /// <summary>One line, bounded: a heredoc Bash command or a stack trace must not reshape the feed.</summary>
    public static string Flatten(string value, int limit)
    {
        var collapsed = string.Join(' ', value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return collapsed.Length <= limit ? collapsed : collapsed[..(limit - 1)] + "…";
    }

    private static string ResultText(JsonObject block)
    {
        var content = block["content"];
        if (Json.Str(content) is { } text) return text;
        if (content is JsonArray parts)
            return string.Join(' ', parts.Select(p => p is JsonObject o ? Json.Str(o["text"]) ?? "" : "").Where(t => t.Length > 0));
        return "failed";
    }
}
