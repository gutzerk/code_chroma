using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>Reading a session's token usage from a claude JSONL transcript fixture.</summary>
public sealed class TranscriptsTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "cc-transcripts-" + Guid.NewGuid().ToString("N")[..8]);

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private static string Assistant(string model, int input, int cacheRead, int cacheCreation, int output, bool sidechain = false) =>
        new JsonObject
        {
            ["type"] = "assistant", ["isSidechain"] = sidechain, ["sessionId"] = "s1",
            ["message"] = new JsonObject
            {
                ["model"] = model,
                ["usage"] = new JsonObject { ["input_tokens"] = input, ["cache_read_input_tokens"] = cacheRead, ["cache_creation_input_tokens"] = cacheCreation, ["output_tokens"] = output },
            },
        }.ToJsonString();

    private void WriteTranscript(string project, string session, params string[] lines)
    {
        Directory.CreateDirectory(Path.Combine(_root, project));
        File.WriteAllLines(Path.Combine(_root, project, session + ".jsonl"), lines);
    }

    [Fact]
    public void Usage_comes_from_the_last_main_thread_assistant_entry()
    {
        WriteTranscript("C--work-tree", "s1",
            """{"type":"user","cwd":"C:/work/tree","sessionId":"s1","message":{"content":"hi"}}""",
            Assistant("claude-old", 1, 10, 10, 5),
            Assistant("claude-opus-5-5", 2, 1000, 300, 70),
            """{"type":"user","sessionId":"s1","message":{"content":"tool result"}}""",
            Assistant("claude-haiku-5-5", 9, 9, 9, 9, sidechain: true),
            "not json");

        var usage = Transcripts.ReadUsage("s1", "C:/work/tree", _root);

        Assert.NotNull(usage);
        Assert.Equal(1302, usage.ContextTokens);
        Assert.Equal(2, usage.InputTokens);
        Assert.Equal(70, usage.OutputTokens);
        Assert.Equal(1000, usage.CacheReadTokens);
        Assert.Equal("claude-opus-5-5", usage.Model);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("empty")]
    public void A_missing_transcript_or_one_without_usage_yields_null(string session)
    {
        WriteTranscript("C--work-tree", "empty", """{"type":"user","cwd":"C:/work/tree","sessionId":"empty"}""");

        var usage = Transcripts.ReadUsage(session, "C:/work/tree", _root);

        Assert.Null(usage);
    }
}
