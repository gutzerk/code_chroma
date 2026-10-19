using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Wiki;
using CodeChroma.Bridge.Workspaces;
using CodeChroma.Core;
using CodeChroma.Core.Wiki;

namespace CodeChroma.Bridge.Skills;

/// <summary>
/// The deterministic fan-out: plain code splits the repo into components and containers, and the model only ever answers one
/// bounded, schema-constrained, zero-tool question per call. Nothing is written to .codechroma/wiki-general until every worker
/// call this run needs has succeeded (bridge/wiki_general_pipeline.py).
/// </summary>
public static class WikiGeneralPipeline
{
    private static readonly JsonSerializerOptions Pretty = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private static JsonObject SummarySchema() => Schema(("summary", "string"), ("description", "string"));

    private static JsonObject Schema(params (string Name, string Type)[] fields)
    {
        var properties = new JsonObject();
        foreach (var (name, type) in fields) properties[name] = new JsonObject { ["type"] = type };
        return new JsonObject
        {
            ["type"] = "object", ["properties"] = properties,
            ["required"] = new JsonArray(fields.Select(f => (JsonNode?)f.Name).ToArray()),
        };
    }

    private static readonly JsonObject UndeterminedSchema = new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["assignments"] = new JsonObject
            {
                ["type"] = "array",
                ["items"] = Schema(("file", "string"), ("component_id", "string")),
            },
        },
        ["required"] = new JsonArray("assignments"),
    };

    private static string Dump(JsonNode node) => node.ToJsonString(Pretty);

    private static string RenderWikiContext(WikiContextBundle bundle)
    {
        if (!bundle.HasWiki) return "(this repository has no plain wiki yet)";
        var parts = new List<string>();
        if (!string.IsNullOrEmpty(bundle.Root)) parts.Add(bundle.Root);
        parts.AddRange(bundle.Pages.Select(p => $"### {p.Path} ({p.Kind})\n{p.Content}"));
        if (bundle.Gaps.Count > 0) parts.Add($"(no wiki page exists for: {string.Join(", ", bundle.Gaps.Order(StringComparer.Ordinal))})");
        return string.Join("\n\n", parts);
    }

    // Go _test.go, Python test_*.py/*_test.py, TS *.test.ts/*.spec.ts, Java Test*.java/*Test.java.
    private static bool IsTestFile(string path)
    {
        var name = path[(path.LastIndexOf('/') + 1)..];
        var dot = name.LastIndexOf('.');
        var stem = dot > 0 ? name[..dot] : name;
        return stem.StartsWith("test_", StringComparison.Ordinal) || stem.StartsWith("Test", StringComparison.Ordinal)
            || new[] { "_test", ".test", "_spec", ".spec", "Test" }.Any(s => stem.EndsWith(s, StringComparison.Ordinal));
    }

    private static JsonObject Element(string name, string? docstring, string file, string? className, string? functionName)
    {
        // Collapse a line-wrapped doc comment, else a raw newline lands inside one bullet line.
        var oneLine = string.IsNullOrEmpty(docstring) ? "" : SkillOutput.Flatten(docstring, docstring.Length);
        return new JsonObject
        {
            ["name"] = name,
            ["description"] = oneLine.Length > 0 ? WikiGeneralJobContext.FirstSentence(oneLine) : WikiWriter.NoDocstring,
            ["file"] = file,
            ["class_name"] = className,
            ["function_name"] = functionName,
        };
    }

    /// <summary>Every class, method and function the files actually have, straight off the parsed graph.</summary>
    private static JsonArray DeterministicElements(Dictionary<string, DependencyDigest.FileSymbolsView> byPath, IEnumerable<string> files)
    {
        var elements = new JsonArray();
        foreach (var file in files)
        {
            if (IsTestFile(file) || !byPath.TryGetValue(file, out var symbols)) continue;
            foreach (var cls in symbols.Classes)
            {
                elements.Add(Element(cls.Name, cls.Docstring, file, cls.Name, null));
                foreach (var method in symbols.MethodsByClassId.GetValueOrDefault(cls.Id) ?? [])
                    elements.Add(Element(method.Name, method.Docstring, file, cls.Name, method.Name));
            }
            foreach (var function in symbols.Functions) elements.Add(Element(function.Name, function.Docstring, file, null, function.Name));
        }
        return elements;
    }

    private static Dictionary<string, SortedSet<string>> NeighborMap(Dictionary<(string, string), int> edges)
    {
        var neighbors = new Dictionary<string, SortedSet<string>>();
        foreach (var (from, to) in edges.Keys)
        {
            if (!neighbors.TryGetValue(from, out var a)) neighbors[from] = a = new SortedSet<string>(StringComparer.Ordinal);
            if (!neighbors.TryGetValue(to, out var b)) neighbors[to] = b = new SortedSet<string>(StringComparer.Ordinal);
            a.Add(to);
            b.Add(from);
        }
        return neighbors;
    }

    private static IEnumerable<string> ConnectionsLines(IReadOnlyCollection<string>? neighbors)
    {
        if (neighbors is null || neighbors.Count == 0) yield break;
        yield return "";
        yield return "## Connections";
        yield return "";
        foreach (var n in neighbors.Order(StringComparer.Ordinal)) yield return $"- Connects: `{n}`";
    }

    private static string RenderC3Page(string name, string description, JsonArray elements, IReadOnlyCollection<string>? neighbors)
    {
        var lines = new List<string> { $"# {name}", "", description.Trim(), "", "## Elements", "" };
        foreach (var element in elements.OfType<JsonObject>())
        {
            var elName = Json.Truthy(element["name"]) ? element["name"]!.ToString() : "Element";
            var elDesc = (Json.Truthy(element["description"]) ? element["description"]!.ToString() : "").Trim().TrimEnd('.');
            lines.Add($"- **{elName}** — {elDesc}.");
            if (Json.Str(element["file"]) is not { Length: > 0 } file) continue;
            lines.Add($"  - File: `{file}`");
            if (Json.Str(element["class_name"]) is { Length: > 0 } cls) lines.Add($"  - Class: `{file}::{cls}`");
            if (Json.Str(element["function_name"]) is { Length: > 0 } fn) lines.Add($"  - Function: `{file}::{fn}`");
        }
        lines.AddRange(ConnectionsLines(neighbors));
        return string.Join('\n', lines) + "\n";
    }

    private static string RenderC2Page(string name, string description, IEnumerable<(string Id, string Name, string Summary)> components, IReadOnlyCollection<string>? neighbors)
    {
        var lines = new List<string> { $"# {name}", "", description.Trim(), "", "## Components", "" };
        foreach (var (id, componentName, summary) in components) lines.Add($"- [{componentName}](../c3/{id}.md) — {summary.Trim().TrimEnd('.')}");
        lines.AddRange(ConnectionsLines(neighbors));
        return string.Join('\n', lines) + "\n";
    }

    private static string RenderIndex(string repoName, string narrative, IEnumerable<(string Id, string Name, string Summary)> containers)
    {
        var lines = new List<string> { $"# {repoName} — Architecture Map", "", narrative.Trim(), "", "## Containers", "" };
        foreach (var (id, name, summary) in containers) lines.Add($"- [{name}](c2/{id}.md) — {summary.Trim().TrimEnd('.')}");
        return string.Join('\n', lines) + "\n";
    }

    /// <summary>file to the chosen real component id; never unassigned, it falls back to the first candidate.</summary>
    private static Dictionary<string, List<string>> ResolveUndeterminedAssignments(
        IReadOnlyList<string> undetermined, Dictionary<string, List<string>> candidatesByFile, JsonObject data)
    {
        var chosen = new Dictionary<string, string>();
        foreach (var entry in (data["assignments"] as JsonArray ?? []).OfType<JsonObject>())
            if (Json.Str(entry["file"]) is { } file && Json.Str(entry["component_id"]) is { } id) chosen[file] = id;
        var extra = new Dictionary<string, List<string>>();
        foreach (var file in undetermined)
        {
            var candidates = candidatesByFile.GetValueOrDefault(file) ?? [];
            var pick = chosen.GetValueOrDefault(file);
            if (pick is null || !candidates.Contains(pick)) pick = candidates.Count > 0 ? candidates[0] : null;
            if (pick is null)
            {
                Console.Error.WriteLine($"wiki-general pipeline: '{file}' has no candidate component, dropped");
                continue;
            }
            if (!extra.TryGetValue(pick, out var list)) extra[pick] = list = [];
            list.Add(file);
        }
        return extra;
    }

    /// <summary>The RunBody the full-rebuild wiki-general agent plugs in.</summary>
    public static async Task<JobState> Run(SkillAgent agent, Workspace? workspace, string repoId, OnOutput? onOutput, CancellationToken token)
    {
        if (workspace is null) return new JobState("error", "wiki-general pipeline requires a workspace");
        using var log = agent.OpenDebugLog(repoId);
        var started = DateTime.UtcNow;
        SkillAgent.DebugWrite(log, $"{Stamp()} PIPELINE START repo={repoId}\n");
        try
        {
            return await RunFanOut(agent, workspace, repoId, onOutput, log, token);
        }
        catch (Exception error)
        {
            SkillAgent.DebugWrite(log, $"{Stamp()} PIPELINE CRASHED {error.GetType().Name}: {error.Message}\n");
            throw;
        }
        finally
        {
            SkillAgent.DebugWrite(log, $"{Stamp()} PIPELINE END dur={(DateTime.UtcNow - started).TotalSeconds:F1}s\n");
        }
    }

    private static string Stamp() => DateTime.UtcNow.ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture);

    private static async Task<JobState> RunFanOut(SkillAgent agent, Workspace workspace, string repoId, OnOutput? onOutput, TextWriter? log, CancellationToken token)
    {
        async Task Emit(string line)
        {
            if (onOutput is not null) await onOutput(repoId, [line]);
        }

        var cli = agent.ResolveCli();
        // An explicit --model re-triggers the CLI's rejection; omit it when ANTHROPIC_MODEL carries it.
        var model = cli.EnvOverrides.ContainsKey("ANTHROPIC_MODEL") ? "" : cli.Model;
        ClaudeAdapter adapter;
        try
        {
            adapter = WikiGeneralWorker.RequireMinimalContextSupport(CliAdapters.All[cli.AdapterKey], cli.Binary);
        }
        catch (UnsupportedAdapterException error)
        {
            return new JobState("error", error.Message);
        }

        var clustering = workspace.Engine.BuildClusters(workspace.Root);
        var componentGroups = clustering?.Components.Select(c => (c.Id, Files: c.Files)).ToList() ?? [];
        if (componentGroups.Count == 0) return new JobState("error", "clustering produced no components to document");
        var componentResolved = WikiGeneralNaming.AssignIds(componentGroups, topLevel: false);

        var componentContainerInternal = new Dictionary<string, string>();
        foreach (var container in clustering!.Containers)
            foreach (var componentId in container.ComponentIds) componentContainerInternal[componentId] = container.Id;
        var containerFiles = new List<(string Id, List<string> Files)>();
        var containerMembers = new Dictionary<string, List<string>>();
        foreach (var component in clustering.Components)
        {
            if (!componentContainerInternal.TryGetValue(component.Id, out var owner)) continue;
            var index = containerFiles.FindIndex(e => e.Id == owner);
            if (index < 0) containerFiles.Add((owner, [.. component.Files]));
            else containerFiles[index].Files.AddRange(component.Files);
            if (!containerMembers.TryGetValue(owner, out var members)) containerMembers[owner] = members = [];
            members.Add(component.Id);
        }
        var containerGroups = containerFiles.Select(e => (e.Id, (IReadOnlyList<string>)e.Files)).ToList();
        var containerResolved = WikiGeneralNaming.AssignIds(containerGroups, topLevel: true);

        var componentRealId = componentResolved.ToDictionary(r => r.InternalId, r => r.RealId);
        var containerRealId = containerResolved.ToDictionary(r => r.InternalId, r => r.RealId);
        var componentEdges = Clustering.AggregateEdgeList(componentRealId, clustering.ComponentEdges.Select(e => (e.FromId, e.ToId, e.Count)));
        var containerEdges = Clustering.AggregateEdgeList(containerRealId, clustering.ContainerEdges.Select(e => (e.FromId, e.ToId, e.Count)));
        var componentNeighbors = NeighborMap(componentEdges);
        var containerNeighbors = NeighborMap(containerEdges);

        var wikiDir = WikiContext.WikiDir(workspace.Root);
        var undetermined = clustering.UndeterminedFiles;
        var concurrency = WikiGeneralPipelineSettings.WorkerConcurrency;
        using var gate = new SemaphoreSlim(concurrency);
        var inFlight = 0;
        var completed = 0;
        // The canvas progress bar's denominator: undetermined + c3s + c2s + narrative.
        var totalJobs = (undetermined.Count > 0 ? 1 : 0) + componentGroups.Count + containerGroups.Count + 1;

        async Task<WorkerResult> Worker(string prompt, JsonObject schema, string label)
        {
            WorkerResult result;
            int done;
            await gate.WaitAsync(token);
            try
            {
                // Counted inside the semaphore, not before it, or every queued job inflates the number.
                var now = Interlocked.Increment(ref inFlight);
                SkillAgent.DebugWrite(log, $"{Stamp()} START {label} (in_flight={now}/{concurrency})\n");
                var jobStarted = DateTime.UtcNow;
                try
                {
                    result = await WikiGeneralWorker.Run(agent, repoId, workspace.Root, adapter, cli, model, prompt, schema, label, token);
                }
                catch
                {
                    SkillAgent.DebugWrite(log, $"{Stamp()} CANCELLED {label} (in_flight={Interlocked.Decrement(ref inFlight)})\n");
                    throw;
                }
                done = Interlocked.Increment(ref completed);
                var left = Interlocked.Decrement(ref inFlight);
                var status = result.Ok ? "ok" : $"FAILED: {result.Error}";
                SkillAgent.DebugWrite(log, $"{Stamp()} END   {label} dur={(DateTime.UtcNow - jobStarted).TotalSeconds:F1}s {status} (in_flight={left})\n");
            }
            finally
            {
                gate.Release();
            }
            // Outside the semaphore (a socket send shouldn't hold up the next slot); the canvas parses this line.
            await Emit($"→ {done}/{totalJobs} {label}");
            return result;
        }

        // --- resolve-undetermined: one batched call, 0+ files ---
        var extraFiles = new Dictionary<string, List<string>>();
        if (undetermined.Count > 0)
        {
            await Emit($"⏺ resolve-undetermined ({undetermined.Count} files)");
            var candidatesByFile = undetermined.ToDictionary(f => f, f => Clustering.UndeterminedCandidates(f, clustering)
                .Where(c => componentRealId.ContainsKey(c.Id)).Select(c => componentRealId[c.Id]).ToList());
            var context = WikiGeneralJobContext.Build(wikiDir, undetermined);
            var listing = new JsonArray(undetermined.Select(f => (JsonNode?)new JsonObject
            {
                ["file"] = f,
                ["candidates"] = new JsonArray(candidatesByFile[f].Select(c => (JsonNode?)c).ToArray()),
            }).ToArray());
            var prompt = Prompts.Render("wiki_general_job_resolve_undetermined",
                ("files_with_candidates_json", Dump(listing)), ("wiki_context", RenderWikiContext(context)));
            var result = await Worker(prompt, UndeterminedSchema, "resolve-undetermined");
            if (!result.Ok) return new JobState("error", $"resolve-undetermined failed: {result.Error}");
            extraFiles = ResolveUndeterminedAssignments(undetermined, candidatesByFile, result.Data!);
            await Emit("✓ done");
        }

        var finalFiles = new Dictionary<string, List<string>>();
        foreach (var (internalId, files) in componentGroups)
        {
            var real = componentRealId[internalId];
            finalFiles[real] = files.Concat(extraFiles.GetValueOrDefault(real) ?? []).Distinct().Order(StringComparer.Ordinal).ToList();
        }

        // --- write-c3: one call per component, concurrent ---
        await Emit($"⏺ write-c3 ({componentGroups.Count} components)");
        var symbolsByPath = DependencyDigest.GroupByFile(workspace.Engine.GraphSnapshot() ?? throw new InvalidOperationException("the engine has no graph"));

        async Task<(string RealId, WorkerResult Result)> WriteC3(string internalId)
        {
            var (_, realId, name) = componentResolved.First(r => r.InternalId == internalId);
            var containerName = componentContainerInternal.TryGetValue(internalId, out var owner)
                ? containerResolved.First(r => r.InternalId == owner).Name : "";
            var files = finalFiles[realId];
            var context = WikiGeneralJobContext.Build(wikiDir, files);
            var prompt = Prompts.Render("wiki_general_job_write_c3",
                ("display_name", name), ("component_id", realId), ("container_name", containerName),
                ("files_csv", string.Join(", ", files)), ("wiki_context", RenderWikiContext(context)));
            var result = await Worker(prompt, SummarySchema(), $"c3:{realId}");
            if (result.Ok && result.Data is not null) result.Data["elements"] = DeterministicElements(symbolsByPath, files);
            return (realId, result);
        }

        var c3Outcomes = await Task.WhenAll(componentGroups.Select(g => WriteC3(g.Id)));
        if (c3Outcomes.FirstOrDefault(o => !o.Result.Ok) is { Result: not null } c3Failed && !c3Failed.Result.Ok)
            return new JobState("error", $"write-c3 failed for {c3Failed.RealId}: {c3Failed.Result.Error}");
        var componentPages = c3Outcomes.ToDictionary(o => o.RealId, o => o.Result.Data!);
        await Emit("✓ done");

        // --- write-c2: one call per container, concurrent, barrier on every C3 above ---
        await Emit($"⏺ write-c2 ({containerGroups.Count} containers)");
        var componentNames = componentResolved.ToDictionary(r => r.RealId, r => r.Name);

        async Task<(string RealId, WorkerResult Result)> WriteC2(string internalId)
        {
            var (_, realId, name) = containerResolved.First(r => r.InternalId == internalId);
            var members = new JsonArray((containerMembers.GetValueOrDefault(internalId) ?? []).Select(cid => (JsonNode?)new JsonObject
            {
                ["id"] = componentRealId[cid],
                ["name"] = componentNames.GetValueOrDefault(componentRealId[cid], ""),
            }).ToArray());
            var prompt = Prompts.Render("wiki_general_job_write_c2",
                ("display_name", name), ("container_id", realId), ("components_json", Dump(members)));
            return (realId, await Worker(prompt, SummarySchema(), $"c2:{realId}"));
        }

        var c2Outcomes = await Task.WhenAll(containerGroups.Select(g => WriteC2(g.Id)));
        if (c2Outcomes.FirstOrDefault(o => !o.Result.Ok) is { Result: not null } c2Failed && !c2Failed.Result.Ok)
            return new JobState("error", $"write-c2 failed for {c2Failed.RealId}: {c2Failed.Result.Error}");
        var containerPages = c2Outcomes.ToDictionary(o => o.RealId, o => o.Result.Data!);
        await Emit("✓ done");

        // --- system-narrative: one call, barrier on every C2 above ---
        await Emit("⏺ system-narrative");
        var containersJson = new JsonArray(containerResolved.Select(r => (JsonNode?)new JsonObject
        {
            ["id"] = r.RealId, ["name"] = r.Name, ["summary"] = Json.Str(containerPages[r.RealId]["summary"]) ?? "",
        }).ToArray());
        var narrativeResult = await Worker(
            Prompts.Render("wiki_general_job_system_narrative", ("containers_json", Dump(containersJson))),
            Schema(("narrative", "string")), "system-narrative");
        if (!narrativeResult.Ok) return new JobState("error", $"system-narrative failed: {narrativeResult.Error}");
        var narrative = narrativeResult.Data!["narrative"]?.ToString() ?? "";
        await Emit("✓ done");

        // --- deterministic write: pages + index.md + manifest.json, no model call from here on ---
        var directory = WikiGeneral.Dir(workspace.Root);
        await Task.Run(() => WritePagesAndManifest(
            workspace, directory, componentResolved, containerResolved, componentContainerInternal, containerMembers, containerFiles,
            componentRealId, containerRealId, componentNames, finalFiles, componentPages, containerPages, componentNeighbors,
            containerNeighbors, componentEdges, containerEdges, narrative), token);

        // --- self-check: never report success on a run whose check didn't return OK ---
        await Emit("⏺ self-check");
        var (exitCode, lines) = WikiGeneralCheck.Run(directory, paths => WikiContext.Build(wikiDir, paths).Gaps.ToHashSet());
        foreach (var line in lines) await Emit(line);
        if (exitCode != 0) return new JobState("error", $"self-check failed ({exitCode}): {(lines.Count > 0 ? lines[0] : "")}");
        await Emit("✓ done");
        return new JobState("idle", null);
    }

    private static void WritePagesAndManifest(
        Workspace workspace, string directory,
        List<(string InternalId, string RealId, string Name)> componentResolved,
        List<(string InternalId, string RealId, string Name)> containerResolved,
        Dictionary<string, string> componentContainerInternal, Dictionary<string, List<string>> containerMembers,
        List<(string Id, List<string> Files)> containerFiles, Dictionary<string, string> componentRealId, Dictionary<string, string> containerRealId,
        Dictionary<string, string> componentNames, Dictionary<string, List<string>> finalFiles,
        Dictionary<string, JsonObject> componentPages, Dictionary<string, JsonObject> containerPages,
        Dictionary<string, SortedSet<string>> componentNeighbors, Dictionary<string, SortedSet<string>> containerNeighbors,
        Dictionary<(string, string), int> componentEdges, Dictionary<(string, string), int> containerEdges, string narrative)
    {
        Directory.CreateDirectory(Path.Combine(directory, "c2"));
        Directory.CreateDirectory(Path.Combine(directory, "c3"));

        var manifestComponents = new JsonArray();
        foreach (var (internalId, realId, name) in componentResolved)
        {
            var page = componentPages[realId];
            WikiGenerator.WriteTextFile(Path.Combine(directory, "c3", realId + ".md"), RenderC3Page(
                Json.Str(page["summary"]) ?? "", Json.Str(page["description"]) ?? "", page["elements"] as JsonArray ?? [], componentNeighbors.GetValueOrDefault(realId)));
            var owner = componentContainerInternal.TryGetValue(internalId, out var ownerInternal) ? containerRealId.GetValueOrDefault(ownerInternal) : null;
            manifestComponents.Add(new JsonObject
            {
                ["id"] = realId, ["name"] = name, ["container"] = owner, ["path"] = $"c3/{realId}.md",
                ["files"] = new JsonArray(finalFiles[realId].Select(f => (JsonNode?)f).ToArray()),
            });
        }

        var manifestContainers = new JsonArray();
        foreach (var (internalId, realId, name) in containerResolved)
        {
            var page = containerPages[realId];
            var members = (containerMembers.GetValueOrDefault(internalId) ?? []).Select(cid =>
                (componentRealId[cid], componentNames.GetValueOrDefault(componentRealId[cid], ""), Json.Str(componentPages[componentRealId[cid]]["summary"]) ?? ""));
            WikiGenerator.WriteTextFile(Path.Combine(directory, "c2", realId + ".md"), RenderC2Page(
                Json.Str(page["summary"]) ?? "", Json.Str(page["description"]) ?? "", members, containerNeighbors.GetValueOrDefault(realId)));
            manifestContainers.Add(new JsonObject
            {
                ["id"] = realId, ["name"] = name, ["path"] = $"c2/{realId}.md",
                ["files"] = new JsonArray(containerFiles.First(e => e.Id == internalId).Files.Select(f => (JsonNode?)f).ToArray()),
            });
        }

        var indexContainers = containerResolved.Select(r => (r.RealId, r.Name, Json.Str(containerPages[r.RealId]["summary"]) ?? ""));
        WikiGenerator.WriteTextFile(Path.Combine(directory, "index.md"), RenderIndex(new DirectoryInfo(workspace.Root).Name, narrative, indexContainers));

        IEnumerable<JsonNode?> Edges(Dictionary<(string, string), int> edges) => edges
            .OrderBy(kv => kv.Key.Item1, StringComparer.Ordinal).ThenBy(kv => kv.Key.Item2, StringComparer.Ordinal)
            .Select(kv => (JsonNode?)new JsonObject { ["from"] = kv.Key.Item1, ["to"] = kv.Key.Item2, ["count"] = kv.Value });
        JsonFile.Write(Path.Combine(directory, "manifest.json"), new JsonObject
        {
            ["generated_at"] = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'+00:00'", CultureInfo.InvariantCulture),
            ["containers"] = manifestContainers,
            ["components"] = manifestComponents,
            ["edges"] = new JsonArray(Edges(componentEdges).Concat(Edges(containerEdges)).ToArray()),
        });
    }
}
