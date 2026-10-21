using System.Text.Json;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Workflows;

/// <summary>Workflow definitions under .codechroma/workflows and run records under .codechroma/runs, one JSON file each.</summary>
public sealed partial class RunStore(string repoRoot)
{
    private readonly object _io = new();

    public string WorkflowsDir => Path.Combine(repoRoot, ".codechroma", "workflows");

    public string RunsDir => Path.Combine(repoRoot, ".codechroma", "runs");

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._-]*$")]
    private static partial Regex SafeId();

    public static bool IsSafeId(string id) => SafeId().IsMatch(id);

    public List<WorkflowDef> ListWorkflows() => ReadAll<WorkflowDef>(WorkflowsDir);

    public WorkflowDef? GetWorkflow(string id) => IsSafeId(id) ? Read<WorkflowDef>(Path.Combine(WorkflowsDir, id + ".json")) : null;

    public void SaveWorkflow(WorkflowDef def) => Write(Path.Combine(WorkflowsDir, def.Id + ".json"), JsonSerializer.Serialize(def, WorkflowJson.Options));

    public bool TryCreateWorkflow(WorkflowDef def)
    {
        if (!IsSafeId(def.Id)) throw new ArgumentException("Invalid workflow id");
        lock (_io)
        {
            var path = Path.Combine(WorkflowsDir, def.Id + ".json");
            if (File.Exists(path)) return false;
            JsonFile.WriteText(path, JsonSerializer.Serialize(def, WorkflowJson.Options));
            return true;
        }
    }

    public bool DeleteWorkflow(string id)
    {
        if (!IsSafeId(id)) return false;
        lock (_io)
        {
            var path = Path.Combine(WorkflowsDir, id + ".json");
            if (!File.Exists(path)) return false;
            File.Delete(path);
            return true;
        }
    }

    public List<Run> ListRuns() => ReadAll<Run>(RunsDir);

    /// <summary>The ids of the saved runs in file order, without reading any of them.</summary>
    public List<string> RunIds() =>
        Directory.Exists(RunsDir)
            ? Directory.EnumerateFiles(RunsDir, "*.json").OrderBy(p => p, StringComparer.Ordinal).Select(Path.GetFileNameWithoutExtension).OfType<string>().ToList()
            : [];

    public Run? GetRun(string id) => IsSafeId(id) ? Read<Run>(Path.Combine(RunsDir, id + ".json")) : null;

    public void Save(Run run) => Write(Path.Combine(RunsDir, run.Id + ".json"), JsonSerializer.Serialize(run, WorkflowJson.Options));

    public bool DeleteRun(string id)
    {
        if (!IsSafeId(id)) return false;
        lock (_io)
        {
            var path = Path.Combine(RunsDir, id + ".json");
            if (!File.Exists(path)) return false;
            File.Delete(path);
            return true;
        }
    }

    private void Write(string path, string json)
    {
        lock (_io) JsonFile.WriteText(path, json);
    }

    private List<T> ReadAll<T>(string dir) where T : class
    {
        if (!Directory.Exists(dir)) return [];
        return Directory.EnumerateFiles(dir, "*.json").OrderBy(p => p, StringComparer.Ordinal).Select(Read<T>).OfType<T>().ToList();
    }

    private T? Read<T>(string path) where T : class
    {
        try
        {
            lock (_io) return File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path), WorkflowJson.Options) : null;
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }
}
