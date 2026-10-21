using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Context;
using CodeChroma.Bridge.Embeddings;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Workspaces;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace CodeChroma.Bridge.Skills;

/// <summary>A bare process-diagram run: model and context cache are made ready first, then a context-free CLI draws from the tool's output.</summary>
public sealed class ProcessDiagram(SkillAgents agents, DiagramLibrary library, ModelStore models, IServer server)
{
    public const string Kind = "process-diagram";
    private const string SkillName = "codechroma-draw-diagram";

    public static string JobKey(string repoId, string typeId) => $"{repoId}:{typeId}";

    public async Task<JobState> Start(Workspace ws, string typeId, string request, OnChange onChange, OnOutput onOutput)
    {
        var key = JobKey(ws.Id, typeId);
        if (library.LoadType(typeId) is not { } definition) return new JobState("error", $"unknown diagram type: {typeId}");
        var cache = new ContextCache(ws.Root);
        if (!cache.HasWiki()) return new JobState("error", "generate the architecture map (wiki-general) first; the fast diagram path reads it");
        if (ws.Engine.GraphSnapshot() is not { } graph) return new JobState("error", "this engine has no graph snapshot for the context cache");
        if (SkillText(typeId, definition, ws.Root, BridgeAddress.Local(server), request) is not { } prompt) return new JobState("error", "the diagram skill files were not found");
        try
        {
            await models.EnsureAsync();
            await Task.Run(() => cache.Ensure(graph, () => new OnnxEmbedder(models.ModelPath, models.TokenizerPath)));
        }
        catch (Exception error) when (error is HttpRequestException or IOException or InvalidOperationException or Microsoft.ML.OnnxRuntime.OnnxRuntimeException)
        {
            return new JobState("error", $"embedding model unavailable: {error.Message}");
        }
        return await agents[Kind].Start(key, ws.Root, onChange, onOutput, prompt, options: new RunOptions([]) { BareTools = "Bash,Write" });
    }

    /// <summary>The whole prompt of a bare run: the repo root line, the skill text with its placeholders filled, then the request.</summary>
    private string? SkillText(string typeId, JsonObject definition, string repoRoot, string? bridgeUrl, string request)
    {
        if (SkillSync.SkillSource(SkillName) is not { } source) return null;
        var rules = Path.Combine(source, "references", "process-bare.md");
        if (!File.Exists(rules) || !File.Exists(Path.Combine(source, "scripts", "check_diagram.py"))) return null;
        var output = Workspace.DiagramPath(repoRoot, "custom/" + typeId);
        var check = BareSkill.CheckCommand(source, $"--kind custom --type {typeId} --json \"{output}\"" + (bridgeUrl is null ? "" : $" --url {bridgeUrl}"));
        var style = Json.Str(definition["style"]) ?? "boxes-arrows";
        var text = File.ReadAllText(rules).Replace("{CONTEXT_TOOL}", ContextTool.CommandPrefix() + $" --repo-path \"{repoRoot}\" --models-dir \"{models.Directory}\"")
            .Replace("{CHECK_COMMAND}", check).Replace("{TYPE_ID}", typeId).Replace("{STYLE}", style);
        return new StringBuilder().Append("Repository root: ").AppendLine(repoRoot).AppendLine().AppendLine(text).AppendLine()
            .Append("Request: ").AppendLine(request).Append("type_id: ").AppendLine(typeId).Append("Write the JSON to: ").AppendLine(output).ToString();
    }
}
