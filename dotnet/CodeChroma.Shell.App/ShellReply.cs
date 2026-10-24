using System.Text.Json;

namespace CodeChroma.Shell.App;

/// <summary>Answers a page's callId-tagged call: runs the work and resolves or rejects the page's promise through window.__ccReply.</summary>
public static class ShellReply
{
    public static async Task RunAsync(TabView view, string callId, Func<Task<string>> work)
    {
        string reply;
        bool ok;
        try
        {
            reply = await work();
            ok = true;
        }
        catch (Exception e)
        {
            reply = e.Message;
            ok = false;
        }
        await view.Web.ExecuteScriptAsync($"window.__ccReply({JsonSerializer.Serialize(callId)},{(ok ? "true" : "false")},{JsonSerializer.Serialize(reply)});");
    }
}
