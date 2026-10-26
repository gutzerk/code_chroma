using CodeChroma.Bridge.Engine;
using CodeChroma.Core;

namespace CodeChroma.Bridge.Tests.Engine;

public class DependencyDigestWriteTests
{
    private static string TempRepo()
    {
        var root = Directory.CreateTempSubdirectory("cc-digest").FullName;
        File.WriteAllText(Path.Combine(root, "a.py"), "def one():\n    return 1\n");
        return root;
    }

    [Fact]
    public void Analyze_writes_the_dependency_digest()
    {
        var root = TempRepo();

        _ = new CoreGraphEngine(root, new NativeAnalysisExporter());

        Assert.True(File.Exists(DependencyDigest.PathFor(root)));
    }

    [Fact]
    public void Reanalyze_rewrites_the_dependency_digest()
    {
        var root = TempRepo();
        var engine = new CoreGraphEngine(root, new NativeAnalysisExporter());
        var before = File.ReadAllText(DependencyDigest.PathFor(root));
        File.WriteAllText(Path.Combine(root, "a.py"), "def one():\n    return 1\n\ndef two():\n    return one()\n");

        engine.Reanalyze(["a.py"]);

        Assert.NotEqual(before, File.ReadAllText(DependencyDigest.PathFor(root)));
    }
}
