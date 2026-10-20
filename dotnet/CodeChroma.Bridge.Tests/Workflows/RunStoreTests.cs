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

    [Theory]
    [InlineData("../escape")]
    [InlineData("a/b")]
    public void Creating_a_definition_rejects_an_unsafe_id(string id)
    {
        using var repo = new GitSandbox();
        var store = new RunStore(repo.Root);
        Assert.Throws<ArgumentException>(() => store.TryCreateWorkflow(new WorkflowDef { Id = id }));
    }
}
