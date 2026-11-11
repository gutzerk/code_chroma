using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Skills;

/// <summary>Writes a one-agent Claude Code plugin to a private temp dir: `--agents` subagents vanish when an MCP server connects, plugin agents stay.</summary>
public static class SubagentPlugin
{
    private static readonly object DirectoryGate = new();
    private static string? _directory;

    /// <summary>The plugin folder holding <paramref name="name"/> as `agents/<name>.md` (offered as `<plugin>:<name>`); the same content reuses the same folder.</summary>
    public static string Write(string plugin, string name, string description, string prompt, string tools)
    {
        var agent = $"---\nname: {name}\ndescription: {JsonSerializer.Serialize(description)}\ntools: {string.Join(", ", tools.Split(','))}\n---\n\n{prompt}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(plugin + "\0" + agent)))[..16].ToLowerInvariant();
        var root = Path.Combine(PrivateDirectory(), hash);
        Directory.CreateDirectory(Path.Combine(root, ".claude-plugin"));
        Directory.CreateDirectory(Path.Combine(root, "agents"));
        File.WriteAllText(Path.Combine(root, ".claude-plugin", "plugin.json"), new JsonObject { ["name"] = plugin, ["version"] = "0.0.0", ["description"] = description }.ToJsonString());
        File.WriteAllText(Path.Combine(root, "agents", name + ".md"), agent);
        return root;
    }

    /// <summary>A per-process 0700 dir (mkdtemp), as for the MCP config.</summary>
    private static string PrivateDirectory()
    {
        lock (DirectoryGate)
        {
            if (_directory is null || !Directory.Exists(_directory)) _directory = Directory.CreateTempSubdirectory("codechroma-agents-").FullName;
            return _directory;
        }
    }
}
