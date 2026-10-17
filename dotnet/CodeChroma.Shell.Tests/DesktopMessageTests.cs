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
}
