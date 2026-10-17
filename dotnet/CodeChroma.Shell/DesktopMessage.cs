using System.Text.Json;

namespace CodeChroma.Shell;

/// <summary>A message from the canvas page (window.codechromaDesktop) to the shell.</summary>
public sealed record DesktopMessage(string Type, string? Id)
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
            return new DesktopMessage(type.GetString()!, root.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String ? id.GetString() : null);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
