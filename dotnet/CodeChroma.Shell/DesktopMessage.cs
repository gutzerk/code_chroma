using System.Text.Json;
using static CodeChroma.Shell.JsonFields;

namespace CodeChroma.Shell;

/// <summary>A message from the canvas page (window.codechromaDesktop) to the shell.</summary>
public sealed record DesktopMessage(string Type, string? Id, string? CallId = null, string? Method = null, string? Arg = null, AgentSummary? Agents = null)
{
    public static DesktopMessage? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.String) return Parse(root.GetString());
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String) return null;
            var kind = type.GetString()!;
            var agents = kind == "agent-summary" ? AgentSummary.Parse(root) : null;
            return new DesktopMessage(kind, Text(root, "id"), Text(root, "callId"), Text(root, "method"), Text(root, "arg"), agents);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
