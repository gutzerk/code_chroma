namespace CodeChroma.Shell;

/// <summary>Shows the native Save As dialog and returns the chosen path, or null when the user cancels.</summary>
public interface ISaveFilePicker
{
    Task<string?> PickAsync(string suggestedName, string mime);
}

/// <summary>Handles the page's save-file call: asks where to save, then writes the bytes the page sent.</summary>
public sealed class FileSaver(ISaveFilePicker picker)
{
    public async Task<string> SaveAsync(string? name, string? mime, string? base64)
    {
        if (base64 is null) throw new ArgumentException("No file content");
        var path = await picker.PickAsync(Path.GetFileName(name ?? ""), mime ?? "application/octet-stream");
        if (path is null) return """{"saved":false}""";
        await File.WriteAllBytesAsync(path, Convert.FromBase64String(base64));
        return """{"saved":true}""";
    }
}
