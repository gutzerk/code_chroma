namespace CodeChroma.Shell.Tests;

public class DesktopMessageTests
{
    [Theory]
    [InlineData("""{"type":"open-workspace","id":"pr-7"}""", "open-workspace", "pr-7")]
    [InlineData("""{"type":"focus-tab"}""", "focus-tab", null)]
    [InlineData("\"{\\\"type\\\":\\\"close-project\\\"}\"", "close-project", null)]
    public void Canvas_messages_are_parsed_from_json_or_a_json_string(string json, string type, string? id)
    {
        var message = DesktopMessage.Parse(json);

        Assert.Equal(new DesktopMessage(type, id), message);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("[1,2]")]
    [InlineData("""{"id":"pr-7"}""")]
    [InlineData("""{"type":5}""")]
    public void Anything_that_is_not_a_typed_object_is_ignored(string? json)
    {
        Assert.Null(DesktopMessage.Parse(json));
    }

    [Theory]
    [InlineData("""{"type":"updates","callId":"c1","method":"skip","arg":"2.0.0"}""", "c1", "skip", "2.0.0")]
    [InlineData("""{"type":"updates","callId":"c2","method":"check"}""", "c2", "check", null)]
    public void Update_calls_carry_a_call_id_a_method_and_an_optional_argument(string json, string callId, string method, string? arg)
    {
        var message = DesktopMessage.Parse(json);

        Assert.Equal(new DesktopMessage("updates", null, callId, method, arg), message);
    }

    [Fact]
    public void Save_file_calls_carry_the_file_name_mime_type_and_base64_content()
    {
        var message = DesktopMessage.Parse("""{"type":"save-file","callId":"s1","id":"map.png","method":"image/png","arg":"AQID"}""");

        Assert.Equal(new DesktopMessage("save-file", "map.png", "s1", "image/png", "AQID"), message);
    }
}

public class AgentSummaryMessageTests
{
    private const string Summary = """
        {"type":"agent-summary","top":"blocked","count":1,"agents":[
          {"id":"a1","title":"agent1","status":"working","worktree":"br_wt-1","worktree_title":"wt-1",
           "activity":{"tool":"Edit","target":"src/guard/policy.ts","turn_started_at":"2026-11-05T09:58:48Z"},
           "pending_permission":null,"status_since":"2026-11-05T09:58:48Z"},
          {"id":"a2","title":"agent2","status":"blocked","worktree":"br_wt-2","worktree_title":"wt-2","activity":null,
           "pending_permission":{"request_id":"p_ab12cd","tool":"Bash","summary":"Bash(npm run e2e)","at":"2026-11-05T10:00:00Z"},
           "status_since":"2026-11-05T10:00:00Z"},
          {"title":"no id","status":"idle"}
        ]}
        """;

    [Fact]
    public void An_agent_summary_is_parsed_into_typed_agents_skipping_rows_without_an_id()
    {
        var message = DesktopMessage.Parse(Summary);

        var summary = Assert.IsType<AgentSummary>(message?.Agents);
        Assert.Equal(("blocked", 1, 2), (summary.Top, summary.Count, summary.Agents.Count));
        Assert.Equal(new AgentEntry("a1", "agent1", "working", "br_wt-1", "wt-1",
            new AgentActivity("Edit", "src/guard/policy.ts", DateTimeOffset.Parse("2026-11-05T09:58:48Z")), null,
            DateTimeOffset.Parse("2026-11-05T09:58:48Z")), summary.Agents[0]);
        Assert.Equal(new AgentPermission("p_ab12cd", "Bash", "Bash(npm run e2e)", DateTimeOffset.Parse("2026-11-05T10:00:00Z")), summary.Agents[1].PendingPermission);
    }

    [Fact]
    public void A_summary_with_an_unknown_top_and_no_agents_parses_to_an_empty_summary()
    {
        var message = DesktopMessage.Parse("""{"type":"agent-summary","top":"running"}""");

        Assert.Equal(new AgentSummary(null, 0, []), message?.Agents);
    }

    [Fact]
    public void Other_messages_carry_no_agent_summary()
    {
        var message = DesktopMessage.Parse("""{"type":"focus-tab","agents":[]}""");

        Assert.Null(message?.Agents);
    }
}
