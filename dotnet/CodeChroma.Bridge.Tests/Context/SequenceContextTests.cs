using System.Text.Json.Nodes;
using CodeChroma.Bridge.Diagrams;

namespace CodeChroma.Bridge.Tests.Context;

public class SequenceContextTests
{
    private static JsonObject Call(string caller, string callee, string? args = null) =>
        new() { ["event"] = "call", ["caller_node_id"] = caller, ["node_id"] = callee, ["args"] = args };

    [Fact]
    public void Scaffold_registers_participants_and_one_message_per_distinct_hop()
    {
        var trace = new JsonObject { ["steps"] = new JsonArray(Call("a::x", "b::y"), Call("a::x", "b::y"), Call("b::y", "c::z"), new JsonObject { ["event"] = "return" }) };

        var (participants, messages) = SequenceContext.Scaffold(trace);

        Assert.Equal(3, participants.Count);
        Assert.Equal("x", participants[0]!["name"]!.GetValue<string>());
        Assert.Equal(2, messages.Count);
        Assert.Equal(2, messages[1]!["order"]!.GetValue<int>());
    }

    [Fact]
    public void Scaffold_skips_self_calls_and_keeps_distinct_args()
    {
        var trace = new JsonObject { ["steps"] = new JsonArray(Call("a", "a"), Call("a", "b", "1"), Call("a", "b", "2")) };

        var (_, messages) = SequenceContext.Scaffold(trace);

        Assert.Equal(2, messages.Count);
    }

    [Fact]
    public void Scaffold_caps_messages()
    {
        var steps = new JsonArray(Enumerable.Range(0, 100).Select(i => (JsonNode?)Call("a", $"n{i}")).ToArray());

        var (_, messages) = SequenceContext.Scaffold(new JsonObject { ["steps"] = steps });

        Assert.Equal(SequenceContext.MaxMessages, messages.Count);
    }
}
