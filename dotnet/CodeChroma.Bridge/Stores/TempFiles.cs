namespace CodeChroma.Bridge.Stores;

/// <summary>Scratch files under the temp directory that live outside any repo.</summary>
public static class TempFiles
{
    private static readonly HashSet<char> InvalidChars = [.. Path.GetInvalidFileNameChars(), '\\', ':'];

    /// <summary>`temp/folder/name.json` with the name made filename-safe.</summary>
    public static string JsonPath(string folder, string name) =>
        Path.Combine(Path.GetTempPath(), folder, new string(name.Select(c => InvalidChars.Contains(c) ? '_' : c).ToArray()) + ".json");

    /// <summary>Writes the file, creating its folder.</summary>
    public static void Write(string path, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
    }
}
