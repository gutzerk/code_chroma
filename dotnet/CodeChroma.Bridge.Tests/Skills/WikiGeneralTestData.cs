using CodeChroma.Core;

namespace CodeChroma.Bridge.Tests.Skills;

/// <summary>A two-file hand-built graph and its grouping, shared by the wiki-general tests.</summary>
internal static class WikiGeneralTestData
{
    public static Graph Graph(params string[] extraFiles)
    {
        var symbols = new List<Symbol>();
        foreach (var file in new[] { "app/a.py", "app/b.py" }.Concat(extraFiles))
        {
            var stem = Path.GetFileNameWithoutExtension(file);
            symbols.Add(new Symbol { Id = $"{file}::module", FilePath = file, Kind = SymbolKind.Module, Name = stem, Language = "python", Docstring = $"The {stem} module." });
            symbols.Add(new Symbol
            {
                Id = $"{file}::{stem}_main", FilePath = file, Kind = SymbolKind.Function, Name = $"{stem}_main", Language = "python",
                Docstring = $"Runs {stem}. Then more.", StartLine = 3, EndLine = 5, ParentSymbolId = $"{file}::module",
            });
        }
        return new Graph([], symbols);
    }

    public static ClusterResult Clusters(params (string Component, string Container, string[] Files)[] groups)
    {
        var components = groups.Select(g => new ComponentCluster(g.Component, g.Container, g.Files)).ToList();
        var containers = groups.GroupBy(g => g.Container)
            .Select(c => new ContainerCluster(c.Key, c.Select(g => g.Component).ToList())).ToList();
        return new ClusterResult(components, containers, [], [], [], new Dictionary<(string, string), int>());
    }

    public static ClusterResult TwoComponents() => Clusters(("c-a", "top::app", ["app/a.py"]), ("c-b", "top::app", ["app/b.py"]));
}
