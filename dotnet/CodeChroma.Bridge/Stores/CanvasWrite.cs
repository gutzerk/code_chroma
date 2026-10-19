using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Stores;

/// <summary>Where a workspace keeps its canvas files, and what its diff layers compare against.</summary>
public static class WorkspaceCanvasExtensions
{
    /// <summary>Geometry for every element, plus content owned by no diagram.</summary>
    public static string CanvasCorePath(this Workspace ws) => Path.Combine(ws.Root, ".codechroma", "canvas-core.json");

    /// <summary>The directory every diagram's own `&lt;kind&gt;/projection.json` lives under.</summary>
    public static string DiagramsRoot(this Workspace ws) => Path.Combine(ws.Root, ".codechroma", "diagrams");

    /// <summary>What the diff and review layers compare against: HEAD for main, else the merge-base with the integration branch.</summary>
    public static string DiffBase(this Workspace ws)
    {
        if (ws.Id == Workspace.MainId) return "HEAD";
        // A stored hash stops being the divergence point the moment the agent pulls main in.
        var mergeBase = GitRunner.Run(ws.Root, "merge-base", Agents.WorktreeOps.MainBranch(ws.Root), "HEAD")?.Trim();
        return string.IsNullOrEmpty(mergeBase) ? "HEAD" : mergeBase;
    }

}

/// <summary>The one lock per workspace around a canvas read-modify-write, and the shared commit response.</summary>
public static class CanvasWrite
{
    private static readonly ConcurrentDictionary<string, object> Locks = new();

    /// <summary>The lock `PATCH /canvas` and every recipe run take for a workspace id.</summary>
    public static object LockFor(string workspaceId) => Locks.GetOrAdd(workspaceId, _ => new object());

    /// <summary>Saves and pings this repo's connected canvases on success; passes rejection errors on.</summary>
    public static JsonObject Commit(Workspace ws, BatchResult result)
    {
        if (!result.Ok) return Failure(result.Errors);
        var failed = result.Doc!.Save(ws.CanvasCorePath(), ws.DiagramsRoot());
        if (failed.Count > 0)
            return Failure(failed.Select(path => new OpError(-1, "write_failed", $"could not write {path} to disk")));

        var batchId = CanvasIds.New();
        var ids = StringArray(result.Affected);
        ws.Emit(new JsonObject
        {
            ["type"] = "canvas",
            ["batch_id"] = batchId,
            ["affected"] = ids,
            ["new_elements"] = StringArray(result.IdMap.Values),
        });
        var idMap = new JsonObject();
        foreach (var (temp, real) in result.IdMap) idMap[temp] = real;
        return new JsonObject { ["ok"] = true, ["batch_id"] = batchId, ["id_map"] = idMap, ["affected"] = StringArray(result.Affected) };
    }

    private static JsonObject Failure(IEnumerable<OpError> errors) =>
        new() { ["ok"] = false, ["errors"] = new JsonArray(errors.Select(e => (JsonNode?)e.ToJson()).ToArray()) };

    private static JsonArray StringArray(IEnumerable<string> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
}
