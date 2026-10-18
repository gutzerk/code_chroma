using System.Diagnostics;
using System.Text.Json;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

public class TutorialProjectTests
{
    private static string Git(string root, params string[] args)
    {
        var info = new ProcessStartInfo("git") { WorkingDirectory = root, RedirectStandardOutput = true, UseShellExecute = false };
        foreach (var a in args) info.ArgumentList.Add(a);
        using var p = Process.Start(info)!;
        var output = p.StandardOutput.ReadToEnd().Trim();
        p.WaitForExit();
        return output;
    }

    private static JsonDocument Diagram(string root, string kind) =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(root, ".codechroma", "diagrams", kind, $"{kind}.json")));

    private static int Components(JsonElement diagram)
    {
        var parent = diagram.GetProperty("nodes").EnumerateArray().Select(n => n.GetProperty("id").GetString()!).ToDictionary(id => id, id => id);
        string Find(string id) { while (parent[id] != id) id = parent[id]; return id; }
        foreach (var r in diagram.GetProperty("relations").EnumerateArray())
            parent[Find(r.GetProperty("from").GetString()!)] = Find(r.GetProperty("to").GetString()!);
        return parent.Keys.Select(Find).Distinct().Count();
    }

    [Fact]
    public void Writes_a_frontend_backend_and_db_layer_under_the_tutorial_folder()
    {
        using var parent = new TempDir();

        var root = TutorialProject.Create(parent.Path);

        Assert.Equal(parent.Sub(TutorialProject.ProjectName), root);
        Assert.All(new[] { "frontend/ui.ts", "backend/service.py", "db/repository.py" }, f => Assert.True(File.Exists(Path.Combine(root, f)), f));
    }

    [Fact]
    public void Ships_the_code_of_both_features_the_lesson_plans()
    {
        using var parent = new TempDir();

        var root = TutorialProject.Create(parent.Path);

        var service = File.ReadAllText(Path.Combine(root, "backend", "service.py"));
        var repository = File.ReadAllText(Path.Combine(root, "db", "repository.py"));
        Assert.Contains("def search_todos", service);
        Assert.Contains("def count_open_todos", service);
        Assert.Contains("def search(", repository);
        Assert.Contains("def count_open(", repository);
    }

    [Fact]
    public void Calling_again_restores_an_edited_file()
    {
        using var parent = new TempDir();
        var root = TutorialProject.Create(parent.Path);
        File.WriteAllText(Path.Combine(root, "backend", "app.py"), "broken");

        TutorialProject.Create(parent.Path);

        Assert.Contains("handle_get_todos", File.ReadAllText(Path.Combine(root, "backend", "app.py")));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public void Commits_an_older_service_so_the_working_tree_carries_a_change_and_keeps_it(int calls)
    {
        using var parent = new TempDir();
        var root = "";

        for (var i = 0; i < calls; i++) root = TutorialProject.Create(parent.Path);

        Assert.Equal("M backend/service.py", Git(root, "status", "--porcelain"));
    }

    [Theory]
    [InlineData("c1")]
    [InlineData("patterns")]
    [InlineData("impact")]
    public void Ships_a_non_draft_diagram_of_each_kind_with_one_connected_component(string kind)
    {
        using var parent = new TempDir();
        var root = TutorialProject.Create(parent.Path);

        using var doc = Diagram(root, kind);

        Assert.Equal(kind, doc.RootElement.GetProperty("type").GetString());
        Assert.False(doc.RootElement.TryGetProperty("draft", out _));
        Assert.Equal(1, Components(doc.RootElement));
    }

    [Fact]
    public void The_c1_diagram_contains_the_system_node()
    {
        using var parent = new TempDir();
        var root = TutorialProject.Create(parent.Path);

        using var doc = Diagram(root, "c1");

        Assert.Contains("system", doc.RootElement.GetProperty("nodes").EnumerateArray().Select(n => n.GetProperty("id").GetString()));
    }
}
