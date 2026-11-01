using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Wiki;
using CodeChroma.Bridge.Workspaces;
using CodeChroma.Core;
using CodeChroma.Core.Wiki;
using static CodeChroma.Bridge.Skills.WikiGeneralPipeline;

namespace CodeChroma.Bridge.Skills;

/// <summary>
/// Update as the same deterministic fan-out as generate, limited to the delta: one bounded zero-tool worker call per created or
/// rewritten page, so the run is bounded by the delta's size and per-call timeout, never by one model process's single deadline.
/// </summary>
public static partial class WikiGeneralUpdatePipeline
{
    // A "- [name](../c3/id.md) — summary" line of a c2 page or a "- [name](c2/id.md) — summary" line of index.md.
    [GeneratedRegex(@"^- \[[^\]]*\]\((?:\.\./c3/|c2/)([^)/]+)\.md\) — (.*)$", RegexOptions.Multiline)]
    private static partial Regex ListedRe();

    private static string? Text(JsonNode? node) => WikiGeneralUpdate.Text(node);

    private static Dictionary<string, string> ListedSummaries(string path)
    {
        string text;
        try { text = Epics.PyText.ReadText(path); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return []; }
        var summaries = new Dictionary<string, string>();
        foreach (Match match in ListedRe().Matches(text)) summaries[match.Groups[1].Value] = match.Groups[2].Value.Trim();
        return summaries;
    }

    private static Dictionary<string, string> NamesById(JsonNode? entries)
    {
        var names = new Dictionary<string, string>();
        foreach (var entry in WikiGeneralUpdate.DictList(entries))
            if (Text(entry["id"]) is { } id) names[id] = Text(entry["name"]) ?? id;
        return names;
    }

    private static List<string> FilesOf(JsonObject entry) =>
        entry["files"] is JsonArray files ? files.Select(Text).OfType<string>().Order(StringComparer.Ordinal).ToList() : [];

    /// <summary>The RunBody the incremental wiki-general-update agent plugs in.</summary>
    public static async Task<JobState> Run(SkillAgent agent, Workspace? workspace, string repoId, OnOutput? onOutput, CancellationToken token)
    {
        if (workspace is null) return new JobState("error", "wiki-general update requires a workspace");
        return await Logged(agent, repoId, log => RunUpdate(agent, workspace, repoId, onOutput, log, token));
    }

    private static async Task<JobState> RunUpdate(SkillAgent agent, Workspace workspace, string repoId, OnOutput? onOutput, TextWriter? log, CancellationToken token)
    {
        JsonObject delta;
        try
        {
            delta = WikiGeneralUpdate.ComputeDelta(workspace);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // A reanalyze or manifest failure must reach the canvas as an error, not crash the run.
            return new JobState("error", error.Message);
        }

        var wikiDir = WikiContext.WikiDir(workspace.Root);
        var directory = WikiGeneral.Dir(workspace.Root);
        var oldManifest = JsonFile.Load(WikiGeneral.ManifestPath(workspace.Root)) as JsonObject ?? new JsonObject();
        var componentDelta = (JsonObject)delta["components"]!;
        var containerDelta = (JsonObject)delta["containers"]!;
        var componentNames = NamesById(oldManifest["components"]);
        var containerNames = NamesById(oldManifest["containers"]);
        var componentJobs = WikiGeneralUpdate.DictList(componentDelta["created"]).Concat(WikiGeneralUpdate.DictList(componentDelta["rewritten"])).ToList();
        var containerJobs = WikiGeneralUpdate.DictList(containerDelta["created"]).Concat(WikiGeneralUpdate.DictList(containerDelta["rewritten"])).ToList();
        foreach (var entry in componentJobs.Where(e => Text(e["name"]) is not null)) componentNames[Text(entry["id"])!] = Text(entry["name"])!;
        foreach (var entry in containerJobs.Where(e => Text(e["name"]) is not null)) containerNames[Text(entry["id"])!] = Text(entry["name"])!;
        var containerChanged = containerJobs.Count > 0 || (containerDelta["deleted"] as JsonArray)?.Count > 0;

        // Nothing to write: refresh the manifest (deletions, edges, timestamp) without resolving a CLI or touching the plain wiki.
        if (componentJobs.Count == 0 && !containerChanged)
        {
            await Task.Run(() => WikiGeneralUpdate.ApplyDelta(workspace, delta), token);
            return new JobState("idle", null);
        }

        var (cli, model, adapter, adapterError) = ResolveWorkerCli(agent);
        if (adapter is null) return new JobState("error", adapterError!);
        try
        {
            // Workers read the plain wiki and the self-check resolves against it, so a new file needs its page first.
            await Task.Run(() =>
            {
                WikiBootstrap.IfMissing(workspace);
                WikiContext.Sync(workspace);
            }, token);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            return new JobState("error", $"plain wiki sync failed: {error.Message}");
        }

        // Only a created or rewritten component needs its elements, so a container-only delta skips grouping the whole graph.
        var symbolsByPath = componentJobs.Count == 0 ? [] :
            DependencyDigest.GroupByFile(workspace.Engine.GraphSnapshot() ?? throw new InvalidOperationException("the engine has no graph"));

        // The canvas progress bar's denominator: created and rewritten c3s + c2s + the narrative when any container changed.
        var totalJobs = componentJobs.Count + containerJobs.Count + (containerChanged ? 1 : 0);
        using var pool = new WorkerPool(agent, repoId, workspace.Root, adapter, cli, model, log, totalJobs, onOutput, token);

        // --- write-c3: one call per created or rewritten component, concurrent ---
        await pool.Emit($"⏺ write-c3 ({componentJobs.Count} components)");

        async Task<(string Id, WorkerResult Result)> WriteC3(JsonObject entry)
        {
            var id = Text(entry["id"])!;
            var files = FilesOf(entry);
            var prompt = Prompts.Render("wiki_general_job_write_c3",
                ("display_name", componentNames.GetValueOrDefault(id, id)), ("component_id", id),
                ("container_name", containerNames.GetValueOrDefault(Text(entry["container"]) ?? "", "")),
                ("files_csv", string.Join(", ", files)), ("wiki_context", RenderWikiContext(WikiGeneralJobContext.Build(wikiDir, files))));
            var result = await pool.Run(prompt, SummarySchema(), $"c3:{id}");
            if (result.Ok && result.Data is not null) result.Data["elements"] = DeterministicElements(symbolsByPath, files);
            return (id, result);
        }

        var c3Outcomes = await Task.WhenAll(componentJobs.Select(WriteC3));
        if (WorkerPool.Failures(c3Outcomes) is [var c3Failed, ..])
            return new JobState("error", $"write-c3 failed for {c3Failed.Id}: {c3Failed.Result.Error}");
        var componentPages = c3Outcomes.ToDictionary(o => o.Id, o => o.Result.Data!);
        await pool.Emit("✓ done");

        // Every worker call the delta needs for a component has succeeded; only now does the manifest change and stale pages go.
        await Task.Run(() => WikiGeneralUpdate.ApplyDelta(workspace, delta), token);
        var manifest = JsonFile.Load(WikiGeneral.ManifestPath(workspace.Root)) as JsonObject ?? throw new InvalidOperationException("the manifest vanished");
        var components = WikiGeneralUpdate.DictList(manifest["components"]);
        var containers = WikiGeneralUpdate.DictList(manifest["containers"]);
        var edges = WikiGeneralUpdate.DictList(manifest["edges"]);
        var indexSummaries = ListedSummaries(Path.Combine(directory, "index.md"));

        // --- write-c2: one call per created or rewritten container, barrier on every C3 above ---
        await pool.Emit($"⏺ write-c2 ({containerJobs.Count} containers)");

        IEnumerable<JsonObject> MembersOf(string containerId) => components.Where(c => Text(c["container"]) == containerId);

        async Task<(string Id, WorkerResult Result)> WriteC2(JsonObject entry)
        {
            var id = Text(entry["id"])!;
            var members = new JsonArray(MembersOf(id).Select(c => (JsonNode?)new JsonObject { ["id"] = Text(c["id"]), ["name"] = Text(c["name"]) }).ToArray());
            var prompt = Prompts.Render("wiki_general_job_write_c2",
                ("display_name", containerNames.GetValueOrDefault(id, id)), ("container_id", id), ("components_json", Dump(members)));
            return (id, await pool.Run(prompt, SummarySchema(), $"c2:{id}"));
        }

        var c2Outcomes = await Task.WhenAll(containerJobs.Select(WriteC2));
        if (WorkerPool.Failures(c2Outcomes) is [var c2Failed, ..])
            return new JobState("error", $"write-c2 failed for {c2Failed.Id}: {c2Failed.Result.Error}");
        var containerPages = c2Outcomes.ToDictionary(o => o.Id, o => o.Result.Data!);
        await pool.Emit("✓ done");

        // --- system-narrative: only when the container set or any container summary changed ---
        string? narrative = null;
        var containerSummaries = containers.ToDictionary(
            c => Text(c["id"])!, c => containerPages.TryGetValue(Text(c["id"])!, out var page) ? Json.Str(page["summary"]) ?? "" : indexSummaries.GetValueOrDefault(Text(c["id"])!, ""));
        if (containerChanged)
        {
            await pool.Emit("⏺ system-narrative");
            var containersJson = new JsonArray(containers.Select(c => (JsonNode?)new JsonObject
            {
                ["id"] = Text(c["id"]), ["name"] = Text(c["name"]), ["summary"] = containerSummaries[Text(c["id"])!],
            }).ToArray());
            var narrativeResult = await pool.Run(
                Prompts.Render("wiki_general_job_system_narrative", ("containers_json", Dump(containersJson))), Schema(("narrative", "string")), "system-narrative");
            if (!narrativeResult.Ok) return new JobState("error", $"system-narrative failed: {narrativeResult.Error}");
            narrative = narrativeResult.Data!["narrative"]?.ToString() ?? "";
            await pool.Emit("✓ done");
        }

        // --- deterministic write: only the refreshed pages and index.md, no model call from here on ---
        await Task.Run(() =>
        {
            Directory.CreateDirectory(Path.Combine(directory, "c2"));
            Directory.CreateDirectory(Path.Combine(directory, "c3"));
            var componentNeighbors = WikiGeneralUpdate.NeighborsFromEdges(edges, components.Select(c => Text(c["id"])).OfType<string>().ToHashSet());
            var containerNeighbors = WikiGeneralUpdate.NeighborsFromEdges(edges, containers.Select(c => Text(c["id"])).OfType<string>().ToHashSet());
            var componentSummaries = componentPages.ToDictionary(p => p.Key, p => Json.Str(p.Value["summary"]) ?? "");

            foreach (var (id, page) in componentPages)
                WikiGenerator.WriteTextFile(Path.Combine(directory, "c3", id + ".md"), RenderC3Page(
                    componentNames.GetValueOrDefault(id, id), Json.Str(page["description"]) ?? "", page["elements"] as JsonArray ?? [],
                    componentNeighbors.GetValueOrDefault(id)));

            foreach (var (id, page) in containerPages)
            {
                var listed = ListedSummaries(Path.Combine(directory, "c2", id + ".md"));
                var members = MembersOf(id).Select(c => Text(c["id"])!).Select(memberId =>
                    (memberId, componentNames.GetValueOrDefault(memberId, memberId), componentSummaries.GetValueOrDefault(memberId) ?? listed.GetValueOrDefault(memberId, "")));
                WikiGenerator.WriteTextFile(Path.Combine(directory, "c2", id + ".md"), RenderC2Page(
                    containerNames.GetValueOrDefault(id, id), Json.Str(page["description"]) ?? "", members, containerNeighbors.GetValueOrDefault(id)));
            }

            if (narrative is not null)
                WikiGenerator.WriteTextFile(Path.Combine(directory, "index.md"), RenderIndex(
                    new DirectoryInfo(workspace.Root).Name, narrative,
                    containers.Select(c => (Text(c["id"])!, Text(c["name"]) ?? Text(c["id"])!, containerSummaries[Text(c["id"])!]))));
        }, token);

        // --- self-check: never report success on a run whose check didn't return OK ---
        await pool.Emit("⏺ self-check");
        var (exitCode, lines) = WikiGeneralCheck.Run(directory, paths => WikiContext.Build(wikiDir, paths).Gaps.ToHashSet());
        foreach (var line in lines) await pool.Emit(line);
        if (exitCode != 0) return new JobState("error", $"self-check failed ({exitCode}): {(lines.Count > 0 ? lines[0] : "")}");
        await pool.Emit("✓ done");
        return new JobState("idle", null);
    }
}
