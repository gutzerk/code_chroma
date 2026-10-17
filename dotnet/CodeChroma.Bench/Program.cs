using System.Diagnostics;
using CodeChroma.Core;

// Times the ported slice (builder, digest, clustering) on an analyzer-contract JSON file.
// Usage: dotnet run -c Release --project dotnet/CodeChroma.Bench -- <input.json> [runs]
if (args.Length == 0)
{
    Console.Error.WriteLine("usage: CodeChroma.Bench <input.json> [runs]");
    return 1;
}

var runs = args.Length > 1 ? int.Parse(args[1]) : 5;
var clock = Stopwatch.StartNew();
var input = AnalysisInputReader.Load(args[0]);
Console.WriteLine($"load json: {clock.ElapsedMilliseconds} ms ({input.Files.Count} files)");

var resolver = new TableImportResolver(input.ImportResolutions);
for (var run = 0; run < runs; run++)
{
    clock.Restart();
    var built = GraphBuilder.Build(input.Files, resolver);
    var graph = new Graph(built.Nodes, built.Symbols);
    var builtMs = clock.Elapsed.TotalMilliseconds;
    clock.Restart();
    DependencyDigest.Build(graph);
    var digestMs = clock.Elapsed.TotalMilliseconds;
    clock.Restart();
    Clustering.Build(graph, resolver);
    var clusterMs = clock.Elapsed.TotalMilliseconds;
    Console.WriteLine($"run {run}: build {builtMs,7:F1} ms  digest {digestMs,7:F1} ms  clusters {clusterMs,7:F1} ms");
}

Console.WriteLine($"peak working set: {Process.GetCurrentProcess().PeakWorkingSet64 / 1_000_000} MB");
return 0;
