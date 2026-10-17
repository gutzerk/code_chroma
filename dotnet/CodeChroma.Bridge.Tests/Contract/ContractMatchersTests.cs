using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Tests.Contract;

/// <summary>Mirrors tests/contract/test_bridge_contract_matchers.py so both runners agree on matcher semantics.</summary>
public class ContractMatchersTests
{
    private const string Doc = """
        {"nodes": [{"id": "a", "n": 1}, {"id": "b", "n": 2}], "x": {"source": "s"}, "k-1": true}
        """;

    [Theory]
    [InlineData("""{"a": 1}""", """{"a": 1}""", true)]
    [InlineData("""{"a": 1}""", """{"a": 1, "b": 2}""", false)]
    [InlineData("[1, 2]", "[1, 2, 3]", false)]
    [InlineData("""{"$any": true}""", "[1]", true)]
    [InlineData("""{"a": {"$any": true}}""", """{"a": null}""", true)]
    [InlineData("true", "1", false)]
    [InlineData("null", "null", true)]
    [InlineData("\"$REPO/x\"", "\"C:\\\\r\\\\x\"", true)]
    [InlineData("\"a\"", "\"b\"", false)]
    public void Json_matches(string expected, string actual, bool matches) =>
        Assert.Equal(matches, ContractMatchers.JsonMatches(JsonNode.Parse(expected), JsonNode.Parse(actual), "C:/r"));

    [Theory]
    [InlineData("$.x.source", """["s"]""", false)]
    [InlineData("$.nodes[*].id", """["a","b"]""", true)]
    [InlineData("$.nodes[id=b].n", "[2]", true)]
    [InlineData("$.nodes[1].id", """["b"]""", false)]
    [InlineData("$..source", """["s"]""", true)]
    [InlineData("$['k-1']", "[true]", false)]
    [InlineData("$.nope", "[]", false)]
    public void Select_walks_the_tiny_jsonpath(string path, string values, bool fanned)
    {
        var (found, wasFanned) = ContractMatchers.Select(JsonNode.Parse(Doc), path);

        Assert.Equal(new JsonArray(found.ToArray()).ToJsonString(), JsonNode.Parse(values)!.ToJsonString());
        Assert.Equal(fanned, wasFanned);
    }

    [Theory]
    [InlineData("""{"path": "$.nodes[*].id", "equals": ["a", "b"]}""", false)]
    [InlineData("""{"path": "$.nodes[*].id", "contains": "c"}""", true)]
    [InlineData("""{"path": "$.nodes[*]", "count": 2}""", false)]
    [InlineData("""{"path": "$..nope", "absent": true}""", false)]
    [InlineData("""{"path": "$.x", "absent": true}""", true)]
    [InlineData("""{"path": "$.x", "type": "object"}""", false)]
    [InlineData("""{"path": "$.nope", "equals": 1}""", true)]
    public void Check_failures(string check, bool fails)
    {
        var failures = ContractMatchers.CheckFailures(new JsonArray(JsonNode.Parse(check)), JsonNode.Parse(Doc), "C:/r");

        Assert.Equal(fails, failures.Count > 0);
    }
}
