using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Tests.Stores;

public class CanvasUnitTests
{
    private static List<JsonNode?> Notes(int count) =>
        Enumerable.Range(0, count).Select(i => (JsonNode?)new JsonObject { ["op"] = "add_note", ["label"] = $"n{i}" }).ToList();

    [Fact]
    public void A_batch_over_the_op_cap_is_rejected_whole()
    {
        var doc = new CanvasDoc();

        var result = ApplyBatch.Apply(doc, Notes(101));

        Assert.False(result.Ok);
        Assert.Equal("too_many_ops", result.Errors[0].Code);
        Assert.Empty(doc.Elements.Keys);
    }

    [Fact]
    public void A_chunked_batch_adds_every_element_across_chunks()
    {
        var doc = new CanvasDoc();

        var result = ApplyBatch.ApplyChunked(doc, Notes(250), chunkSize: 100);

        Assert.True(result.Ok);
        Assert.Equal(250, result.Doc!.Elements.Count);
        Assert.Empty(doc.Elements.Keys);
    }

    [Fact]
    public void A_chunked_batch_rewrites_a_cross_chunk_temp_id()
    {
        var doc = new CanvasDoc();
        var ops = new List<JsonNode?> { new JsonObject { ["op"] = "add_group", ["temp_id"] = "g" } };
        ops.AddRange(Notes(2));
        ops.Add(new JsonObject { ["op"] = "add_note", ["group_id"] = "g" });

        var result = ApplyBatch.ApplyChunked(doc, ops, chunkSize: 2);

        Assert.True(result.Ok);
        Assert.Contains(result.Doc!.Elements.Values, e => e.GroupId == result.IdMap["g"]);
    }

    [Theory]
    [InlineData("a\nb\n", "a\nb\n", 0, 0)]
    [InlineData("a\nb\n", "a\nc\n", 1, 1)]
    [InlineData("", "x\ny\n", 2, 0)]
    [InlineData("-- sql\n", "", 0, 0)]
    public void Line_deltas_match_the_python_card_counter(string original, string proposed, int added, int removed)
    {
        var delta = LineDiff.Delta(original, proposed);

        Assert.Equal((added, removed), delta);
    }

    [Fact]
    public void A_sequence_recipe_turns_relations_into_message_elements()
    {
        var resolved = JsonNode.Parse("""
            {"nodes":[{"id":"a","name":"A"},{"id":"b","name":"B"}],
             "relations":[{"id":"m1","from":"a","to":"b","label":"hi","order":1},{"id":"m2","from":"a","to":"ghost"}]}
            """)!.AsObject();

        var shape = Recipes.Reshape(resolved, "sequence");

        Assert.Equal(3, shape.Nodes.Count);
        Assert.Equal("message", shape.Nodes[2].Meta!["role"]!.GetValue<string>());
        Assert.Empty(shape.Relations);
    }

    [Fact]
    public void A_sequence_recipe_carries_the_readability_fields_like_python()
    {
        var resolved = JsonNode.Parse("""
            {"phases":[{"id":"p1","name":"Prepare","kind":"prepare","from_order":1,"to_order":1}],"summary":"s",
             "nodes":[{"id":"a","name":"A","lane":"client","path":"a.py"},{"id":"b","name":"B"}],
             "relations":[{"id":"m1","from":"a","to":"b","order":"1","hero":true}]}
            """)!.AsObject();

        var shape = Recipes.Reshape(resolved, "sequence");

        Assert.Equal("client", shape.Nodes[0].Meta!["lane"]!.GetValue<string>());
        Assert.Equal("a.py", shape.Nodes[0].Meta!["path"]!.GetValue<string>());
        Assert.Equal("p1", shape.Nodes[0].Meta!["phases"]![0]!["id"]!.GetValue<string>());
        Assert.Equal("s", shape.Nodes[0].Meta!["summary"]!.GetValue<string>());
        Assert.True(shape.Nodes[2].Meta!["hero"]!.GetValue<bool>());
    }
}
