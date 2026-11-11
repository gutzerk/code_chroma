using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Skills;

/// <summary>Writes a one-agent Claude Code plugin to a private temp dir: `--agents` subagents vanish when an MCP server connects, plugin agents stay.</summary>
public static class SubagentPlugin
{
    private static readonly PrivateTemp Temp = new("codechroma-agents-");

    /// <summary>The plugin folder holding <paramref name="name"/> as `agents/<name>.md` (offered as `<plugin>:<name>`); the same content reuses the same folder.</summary>
    public static string Write(string plugin, string name, string description, string prompt, string tools)
    {
        var agent = $"---\nname: {name}\ndescription: {JsonSerializer.Serialize(description)}\ntools: {string.Join(", ", tools.Split(','))}\n---\n\n{prompt}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(plugin + "\0" + agent)))[..16].ToLowerInvariant();
        var root = Path.Combine(Temp.Get(), hash);
        Directory.CreateDirectory(Path.Combine(root, ".claude-plugin"));
        Directory.CreateDirectory(Path.Combine(root, "agents"));
        WriteOnce(Path.Combine(root, ".claude-plugin", "plugin.json"), new JsonObject { ["name"] = plugin, ["version"] = "0.0.0", ["description"] = description }.ToJsonString());
        WriteOnce(Path.Combine(root, "agents", name + ".md"), agent);
        return root;
    }

    /// <summary>Writes a file a running CLI may be reading: skipped when present (the folder name is its content hash), else written aside and renamed in.</summary>
    private static void WriteOnce(string path, string text)
    {
        if (File.Exists(path)) return;
        var staging = $"{path}.{Guid.NewGuid():N}.tmp";
        File.WriteAllText(staging, text);
        try { File.Move(staging, path, overwrite: true); }
        catch (IOException) when (File.Exists(path)) { File.Delete(staging); }
    }
}
