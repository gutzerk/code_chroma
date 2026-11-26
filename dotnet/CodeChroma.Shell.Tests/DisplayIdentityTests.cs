using System.Text.Json;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

/// <summary>The monitor identity the shell pushes to every page, which keeps a terminal text size per display.</summary>
public class DisplayIdentityTests
{
    [Fact]
    public void A_display_key_names_the_bounds_and_the_scaling()
    {
        var key = DisplayIdentity.Key(-1920, 0, 3840, 2160, 2);

        Assert.Equal("3840x2160+-1920+0@2", key);
    }

    [Fact]
    public void Fractional_scaling_is_kept_to_two_places()
    {
        var key = DisplayIdentity.Key(0, 0, 2880, 1800, 1.33333);

        Assert.Equal("2880x1800+0+0@1.33", key);
    }

    [Fact]
    public void The_display_message_matches_the_desktop_channel_contract()
    {
        var message = JsonSerializer.Deserialize<Dictionary<string, string>>(AgentCommand.Display("1920x1080+0+0@1"));

        Assert.Equal(new Dictionary<string, string> { ["type"] = "display", ["key"] = "1920x1080+0+0@1" }, message);
    }

    [Fact]
    public void A_new_display_is_sent_to_every_tab_once()
    {
        using var h = new ShellHarness();
        h.Controller.NewTab();

        h.Controller.ReportDisplay("A");
        h.Controller.ReportDisplay("A");

        Assert.Equal(2, h.Ui.AgentCommands.Count);
        Assert.All(h.Ui.AgentCommands, sent => Assert.Equal("""{"type":"display","key":"A"}""", sent.Json));
        Assert.Equal(h.Tabs.Tabs.Select(t => t.Id), h.Ui.AgentCommands.Select(sent => sent.Tab.Id));
    }

    [Fact]
    public void A_page_that_loads_later_is_told_the_current_display()
    {
        using var h = new ShellHarness();
        h.Controller.ReportDisplay("B");
        var tab = h.Controller.NewTab();
        h.Ui.AgentCommands.Clear();

        h.Controller.PageLoaded(tab.Id);

        Assert.Equal((tab, """{"type":"display","key":"B"}"""), Assert.Single(h.Ui.AgentCommands));
    }

    [Fact]
    public void Before_any_display_is_known_a_loaded_page_hears_nothing()
    {
        using var h = new ShellHarness();

        h.Controller.PageLoaded(h.Tabs.Tabs[0].Id);

        Assert.Empty(h.Ui.AgentCommands);
    }
}
