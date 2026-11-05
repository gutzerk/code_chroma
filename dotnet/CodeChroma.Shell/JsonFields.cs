using System.Globalization;
using System.Text.Json;

namespace CodeChroma.Shell;

/// <summary>Lenient typed reads of optional fields on page JSON messages.</summary>
internal static class JsonFields
{
    public static string? Text(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    public static DateTimeOffset? Time(JsonElement root, string name) =>
        Text(root, name) is { } text && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var at) ? at : null;
}
