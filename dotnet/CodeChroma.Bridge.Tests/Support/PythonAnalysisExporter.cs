using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using CodeChroma.Bridge.Engine;
using CodeChroma.Core;

namespace CodeChroma.Bridge.Tests.Support;

/// <summary>The wire shape of `python -m codechroma.analysis_export --files`.</summary>
internal sealed record DeltaWire(
    IReadOnlyList<FileSymbols> Changed,
    IReadOnlyList<string> Removed,
    [property: JsonPropertyName("import_resolutions")] IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> ImportResolutions);

/// <summary>Shells out to the Python analyzers (`codechroma.analysis_export`); CODECHROMA_PYTHON picks the interpreter.</summary>
public sealed class PythonAnalysisExporter(string? python = null) : IAnalysisExporter
{
    public const string PythonEnvVar = "CODECHROMA_PYTHON";
    private const int TimeoutSeconds = 600;

    private readonly string _python = python
        ?? Environment.GetEnvironmentVariable(PythonEnvVar)
        ?? (OperatingSystem.IsWindows() ? "python" : "python3");

    public AnalysisInput Full(string root) => AnalysisInputReader.Parse(Run(root, []));

    public AnalysisDelta Delta(string root, IReadOnlyList<string> changedPaths)
    {
        var wire = JsonSerializer.Deserialize<DeltaWire>(Run(root, ["--files", .. changedPaths]), WireJson.Options)
            ?? throw new JsonException("analysis delta is empty");
        return new AnalysisDelta(wire.Changed, wire.Removed, wire.ImportResolutions);
    }

    private string Run(string root, IEnumerable<string> extra)
    {
        var info = new ProcessStartInfo(_python)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            WorkingDirectory = root,
        };
        foreach (var arg in new[] { "-m", "codechroma.analysis_export", root }.Concat(extra)) info.ArgumentList.Add(arg);
        info.Environment["PYTHONIOENCODING"] = "utf-8";
        using var process = Process.Start(info) ?? throw new InvalidOperationException($"could not start {_python}");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(TimeSpan.FromSeconds(TimeoutSeconds)))
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            throw new TimeoutException($"{_python} -m codechroma.analysis_export timed out after {TimeoutSeconds}s");
        }
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"analysis export failed ({process.ExitCode}): {stderr.GetAwaiter().GetResult().Trim()}");
        return stdout.GetAwaiter().GetResult();
    }
}
