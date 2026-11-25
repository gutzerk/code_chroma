using CodeChroma.Bridge.Messages;

namespace CodeChroma.Bridge.Tests.Messages;

public class UnreadFeedTests
{
    private static UnreadItem Item(string id, string source, int minute, string group = "g") =>
        new(id, source, "#x", "Maya", "hi", new DateTimeOffset(2026, 11, 24, 9, minute, 0, TimeSpan.Zero), "https://open/" + id, null, group);

    [Fact]
    public void The_snapshot_lists_every_source_newest_first()
    {
        var feed = new UnreadFeed(() => { });
        feed.Replace("slack", [Item("slack:a", "slack", 1)], DateTimeOffset.UnixEpoch);
        feed.Replace("outlook", [Item("outlook:b", "outlook", 5)], DateTimeOffset.UnixEpoch);

        var snapshot = feed.Snapshot();

        Assert.Equal(["outlook:b", "slack:a"], snapshot["items"]!.AsArray().Select(i => i!["id"]!.GetValue<string>()));
    }

    [Fact]
    public void An_unchanged_recheck_sends_no_ping()
    {
        var pings = 0;
        var feed = new UnreadFeed(() => pings++);
        feed.Replace("slack", [Item("slack:a", "slack", 1)], DateTimeOffset.UnixEpoch);

        feed.Replace("slack", [Item("slack:a", "slack", 1)], DateTimeOffset.UnixEpoch.AddMinutes(1));

        Assert.Equal(1, pings);
    }

    [Fact]
    public void A_failed_poll_keeps_the_last_items_and_reports_the_error()
    {
        var feed = new UnreadFeed(() => { });
        feed.Replace("outlook", [Item("outlook:b", "outlook", 5)], DateTimeOffset.UnixEpoch);

        feed.Fail("outlook", "boom");

        Assert.Equal(("error", "boom", 1), (feed.StateOf("outlook").State, feed.StateOf("outlook").Error, feed.Items("outlook").Count));
    }

    [Fact]
    public void Replacing_one_group_leaves_the_others()
    {
        var feed = new UnreadFeed(() => { });
        feed.Replace("slack", [Item("slack:a", "slack", 1, "C1"), Item("slack:b", "slack", 2, "C2")], DateTimeOffset.UnixEpoch);

        feed.ReplaceWhere("slack", i => i.Group == "C1", [], DateTimeOffset.UnixEpoch);

        Assert.Equal(["slack:b"], feed.Items("slack").Select(i => i.Id));
    }

    [Fact]
    public void Clearing_a_source_marks_it_disconnected()
    {
        var feed = new UnreadFeed(() => { });
        feed.Replace("slack", [Item("slack:a", "slack", 1)], DateTimeOffset.UnixEpoch);

        feed.Clear("slack");

        var source = feed.Snapshot()["sources"]!["slack"]!;
        Assert.Equal(("disconnected", 0), (source["state"]!.GetValue<string>(), feed.Items("slack").Count));
    }
}
