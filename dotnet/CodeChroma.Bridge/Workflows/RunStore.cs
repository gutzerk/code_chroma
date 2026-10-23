using System.Text.Json;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Workflows;

/// <summary>
/// Workflow definitions and run records, one JSON file each. Runs live under the repo's .codechroma/runs. New workflows go to the
/// machine-wide shared directory so every repo sees them; a repo's own .codechroma/workflows still loads and wins on the same id.
/// </summary>
public sealed partial class RunStore(string repoRoot, string? sharedWorkflowsDir = null)
{
    private readonly object _io = new();

    public string WorkflowsDir => Path.Combine(repoRoot, ".codechroma", "workflows");

    public string RunsDir => Path.Combine(repoRoot, ".codechroma", "runs");

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._-]*$")]
    private static partial Regex SafeId();

    public static bool IsSafeId(string id) => SafeId().IsMatch(id);

    /// <summary>The machine-wide workflows directory, or null when this store has none (then only the repo's own workflows exist).</summary>
    public string? SharedWorkflowsDir => sharedWorkflowsDir;

    public List<WorkflowDef> ListWorkflows()
    {
        var own = ReadAll<WorkflowDef>(WorkflowsDir);
        var shared = SharedWorkflowsDir is null ? [] : ReadAll<WorkflowDef>(SharedWorkflowsDir).Where(d => own.All(o => o.Id != d.Id));
        return own.Concat(shared).Select(Normalized).ToList();
    }

    public WorkflowDef? GetWorkflow(string id) =>
        IsSafeId(id) && Dirs().Select(dir => Read<WorkflowDef>(Path.Combine(dir, id + ".json"))).FirstOrDefault(def => def is not null) is { } found ? Normalized(found) : null;

    /// <summary>The repo's own directory first, then the shared one.</summary>
    private IEnumerable<string> Dirs() => SharedWorkflowsDir is null ? [WorkflowsDir] : [WorkflowsDir, SharedWorkflowsDir];

    /// <summary>The directory holding this id now, else the shared one (the repo's when there is none).</summary>
    private string DirFor(string id) => Dirs().FirstOrDefault(dir => File.Exists(Path.Combine(dir, id + ".json"))) ?? SharedWorkflowsDir ?? WorkflowsDir;

    private static WorkflowDef Normalized(WorkflowDef def)
    {
        StepAgents.Normalize(def);
        return def;
    }

    public void SaveWorkflow(WorkflowDef def) => Write(Path.Combine(DirFor(def.Id), def.Id + ".json"), JsonSerializer.Serialize(def, WorkflowJson.Options));

    public bool TryCreateWorkflow(WorkflowDef def)
    {
        if (!IsSafeId(def.Id)) throw new ArgumentException("Invalid workflow id");
        lock (_io)
        {
            if (Dirs().Any(dir => File.Exists(Path.Combine(dir, def.Id + ".json")))) return false;
            var path = Path.Combine(SharedWorkflowsDir ?? WorkflowsDir, def.Id + ".json");
            JsonFile.WriteText(path, JsonSerializer.Serialize(def, WorkflowJson.Options));
            return true;
        }
    }

    public bool DeleteWorkflow(string id)
    {
        if (!IsSafeId(id)) return false;
        lock (_io)
        {
            var found = false;
            foreach (var path in Dirs().Select(dir => Path.Combine(dir, id + ".json")).Where(File.Exists))
            {
                File.Delete(path);
                found = true;
            }
            return found;
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
