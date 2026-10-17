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
}
