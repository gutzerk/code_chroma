using CodeChroma.Bridge.Workflows;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Workflows;

public sealed class RunStoreTests
{
    [Fact]
    public void Creating_a_definition_persists_it_and_refuses_to_replace_it()
    {
        using var repo = new GitSandbox();
        var store = new RunStore(repo.Root);
        var def = new WorkflowDef { Id = "my-workflow", Name = "Original", Steps = [new WorkflowStep { Id = "plan", Slug = "Plan", Prompt = "Plan the change" }] };
        Assert.True(store.TryCreateWorkflow(def));
        def.Name = "Replacement";
        Assert.False(store.TryCreateWorkflow(def));
        Assert.Equal("Original", store.GetWorkflow(def.Id)!.Name);
        Assert.Single(store.ListWorkflows());
    }

    [Fact]
    public void Deleting_a_definition_removes_it_once()
    {
        using var repo = new GitSandbox();
        var store = new RunStore(repo.Root);
        store.TryCreateWorkflow(new WorkflowDef { Id = "doomed", Name = "Doomed" });

        var first = store.DeleteWorkflow("doomed");
        var second = store.DeleteWorkflow("doomed");

        Assert.True(first);
        Assert.False(second);
        Assert.Null(store.GetWorkflow("doomed"));
    }

    [Theory]
    [InlineData("../escape")]
    [InlineData("a/b")]
    public void Creating_a_definition_rejects_an_unsafe_id(string id)
    {
        using var repo = new GitSandbox();
        var store = new RunStore(repo.Root);
        Assert.Throws<ArgumentException>(() => store.TryCreateWorkflow(new WorkflowDef { Id = id }));
    }

    [Theory]
    [InlineData("\"context\": \"previous\",", "handoff")]
    [InlineData("\"context\": \"fresh\",", "new")]
    [InlineData("", "handoff")]
    public void An_older_context_field_loads_as_an_agent_mode_and_is_not_written_back(string contextLine, string expected)
    {
        using var repo = new GitSandbox();
        var store = new RunStore(repo.Root);
        var dir = Path.Combine(repo.Root, ".codechroma", "workflows");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "old.json"), "{\"id\": \"old\", \"name\": \"Old\", \"steps\": [{\"id\": \"a\", \"slug\": \"a\", \"kind\": \"agent\", " + contextLine + " \"prompt\": \"go\"}]}");

        var loaded = store.GetWorkflow("old")!;
        store.SaveWorkflow(loaded);
        var written = File.ReadAllText(Path.Combine(dir, "old.json"));

        Assert.Equal(expected, loaded.Steps[0].Agent);
        Assert.Equal(expected, store.ListWorkflows().Single().Steps[0].Agent);
        Assert.DoesNotContain("\"context\"", written);
    }
}
