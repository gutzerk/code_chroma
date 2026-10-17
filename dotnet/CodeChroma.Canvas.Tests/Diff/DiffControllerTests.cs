using CodeChroma.Canvas.Diff;
using CodeChroma.Canvas.Hierarchy;
using CodeChroma.Canvas.Tests.Hierarchy;

namespace CodeChroma.Canvas.Tests.Diff;

internal sealed class FakeDiffBridge : IDiffBridge
{
    public List<FunctionDiff> Diffs { get; set; } = new();
    public ChangeCardSet? Cards { get; set; }
    public bool CardsThrow { get; set; }
    public Exception? AcceptFails { get; set; }
    public TaskCompletionSource<bool>? Gate { get; set; }
    public int DiffCalls { get; private set; }
    public List<string> Accepted { get; } = new();

    public async Task<IReadOnlyList<FunctionDiff>> GetDiffAsync(CancellationToken ct)
    {
        DiffCalls++;
        if (Gate is not null) await Gate.Task.WaitAsync(ct);
        ct.ThrowIfCancellationRequested();
        return Diffs.ToList();
    }

    public Task<ChangeCardSet?> GetChangeCardsAsync(CancellationToken ct) =>
        CardsThrow ? throw new InvalidOperationException("no route") : Task.FromResult(Cards);

    public Task AcceptAsync(string nodeId, CancellationToken ct)
    {
        if (AcceptFails is not null) throw AcceptFails;
        Accepted.Add(nodeId);
        Diffs.RemoveAll(d => d.NodeId == nodeId);
        return Task.CompletedTask;
    }
}

public class DiffControllerTests
{
    private const string Fn = "a1x", Cls = "a1", Folder = "a";

    private static (DiffController Controller, FakeDiffBridge Bridge, ExpansionState Expansion, DiffOverlay Overlay) Make()
    {
        var source = TableSource.Tree();
        var expansion = new ExpansionState(source);
        var bridge = new FakeDiffBridge { Diffs = [new FunctionDiff { NodeId = Fn, OriginalSource = "old", ProposedSource = "new", Status = "modified" }] };
        var overlay = new DiffOverlay();
        return (new DiffController(bridge, source, expansion, overlay), bridge, expansion, overlay);
    }

    private static ChangeCard Card(string node, string status = "modified") => new() { NodeId = node, Status = status, Text = "t" };

    [Fact]
    public async Task A_modified_function_has_its_ancestors_opened_its_code_shown_and_its_diff_published()
    {
        var (c, _, expansion, overlay) = Make();

        var result = await c.RefreshAsync();

        Assert.Equal(new[] { "sys", "a", "a1" }, expansion.ExpandedOrder);
        Assert.True(expansion.IsCodeVisible(Fn));
        Assert.Equal("new", overlay.DiffOf(Fn)!.ProposedSource);
        Assert.True(overlay.IsActive);
        Assert.Single(result!.Diffs);
    }

    [Fact]
    public async Task A_deleted_entry_is_published_but_never_revealed_and_a_whole_file_entry_is_not_expanded_again()
    {
        var (c, bridge, expansion, overlay) = Make();
        bridge.Diffs = [
            new FunctionDiff { NodeId = "gone", Status = "deleted", Name = "gone" },
            new FunctionDiff { NodeId = "a2", Status = "modified", Level = "file" },
        ];

        await c.RefreshAsync();

        Assert.Empty(expansion.ExpandedOrder);
        Assert.Single(overlay.Deleted);
        Assert.NotNull(overlay.DiffOf("a2"));
    }

    [Fact]
    public async Task A_container_entry_is_expanded_rather_than_given_a_code_panel()
    {
        var (c, bridge, expansion, _) = Make();
        bridge.Diffs = [new FunctionDiff { NodeId = Folder, Status = "modified" }];

        await c.RefreshAsync();

        Assert.True(expansion.IsExpanded(Folder));
        Assert.False(expansion.IsCodeVisible(Folder));
    }

    [Fact]
    public async Task Cards_are_revealed_without_their_code_and_a_card_whose_node_shows_a_diff_is_dropped()
    {
        var (c, bridge, expansion, overlay) = Make();
        bridge.Cards = new ChangeCardSet { Cards = [Card("b"), Card(Fn)], ByNodeStatus = new() { ["b"] = "modified", [Fn] = "modified" } };

        var result = await c.RefreshAsync();

        Assert.Equal(new[] { "b" }, result!.Cards.Select(x => x.NodeId));
        Assert.True(expansion.IsExpanded("sys"));
        Assert.False(expansion.IsCodeVisible("b"));
        Assert.Equal("modified", overlay.StatusOf(Fn));
        Assert.Single(overlay.AllCards);
    }

    [Fact]
    public async Task The_block_recolor_status_comes_from_every_card_and_unknown_words_are_dropped()
    {
        var (c, bridge, _, overlay) = Make();
        bridge.Cards = new ChangeCardSet { ByNodeStatus = new() { ["a"] = "added", ["b"] = "removed", ["a2"] = "weird" } };

        await c.RefreshAsync();

        Assert.Equal("added", overlay.StatusOf("a"));
        Assert.Equal("removed", overlay.StatusOf("b"));
        Assert.Null(overlay.StatusOf("a2"));
    }

    [Fact]
    public async Task Diffs_still_publish_when_the_change_card_route_is_unavailable_and_statuses_clear()
    {
        var (c, bridge, _, overlay) = Make();
        bridge.Cards = new ChangeCardSet { ByNodeStatus = new() { ["a"] = "added" } };
        await c.RefreshAsync();
        bridge.CardsThrow = true;

        await c.RefreshAsync();

        Assert.NotNull(overlay.DiffOf(Fn));
        Assert.Null(overlay.StatusOf("a"));
        Assert.Empty(overlay.AllCards);
    }

    [Fact]
    public async Task An_already_cancelled_refresh_resolves_to_null_and_publishes_nothing()
    {
        var (c, _, expansion, overlay) = Make();
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var result = await c.RefreshAsync(cts.Token);

        Assert.Null(result);
        Assert.False(overlay.IsActive);
        Assert.Empty(expansion.ExpandedOrder);
    }

    [Fact]
    public async Task Toggling_on_publishes_and_toggling_off_restores_exactly_what_the_user_had_open()
    {
        var (c, _, expansion, overlay) = Make();
        expansion.Expand("sys");
        expansion.Expand("b");

        await c.ToggleAsync();
        var during = expansion.ExpandedOrder.ToArray();
        await c.ToggleAsync();

        Assert.True(during.Length > 2);
        Assert.Equal(new[] { "sys", "b" }, expansion.ExpandedOrder);
        Assert.False(expansion.IsCodeVisible(Fn));
        Assert.False(overlay.IsActive);
        Assert.Null(overlay.DiffOf(Fn));
    }

    [Fact]
    public async Task A_run_with_zero_changes_still_leaves_the_toggle_active()
    {
        var (c, bridge, _, overlay) = Make();
        bridge.Diffs = new();

        await c.ToggleAsync();

        Assert.True(overlay.IsActive);
        Assert.Empty(overlay.Diffs);
    }

    [Fact]
    public async Task A_click_during_activation_cancels_restores_the_expansion_and_never_publishes_even_when_the_fetch_lands()
    {
        var (c, bridge, expansion, overlay) = Make();
        bridge.Gate = new TaskCompletionSource<bool>();
        expansion.Expand("b");

        var first = c.ToggleAsync();
        var pendingWhileFetching = c.IsPending;
        await c.ToggleAsync();
        bridge.Gate.SetResult(true);
        await first;

        Assert.True(pendingWhileFetching);
        Assert.False(c.IsPending);
        Assert.False(overlay.IsActive);
        Assert.Equal(new[] { "b" }, expansion.ExpandedOrder);
    }

    [Fact]
    public async Task A_failed_activation_clears_pending_restores_the_expansion_and_records_the_error()
    {
        var (c, bridge, expansion, overlay) = Make();
        bridge.Gate = new TaskCompletionSource<bool>();
        var first = c.ToggleAsync();
        bridge.Gate.SetException(new InvalidOperationException("boom"));

        await first;

        Assert.False(c.IsPending);
        Assert.Equal("boom", c.LastError);
        Assert.False(overlay.IsActive);
        Assert.Empty(expansion.ExpandedOrder);
    }

    [Fact]
    public async Task Pending_changes_are_announced_so_the_button_can_show_a_spinner()
    {
        var (c, bridge, _, _) = Make();
        var seen = new List<bool>();
        c.PendingChanged += () => seen.Add(c.IsPending);

        await c.ToggleAsync();

        Assert.Equal(new[] { true, false }, seen);
    }

    [Fact]
    public async Task A_burst_of_live_refreshes_coalesces_into_the_run_in_flight_plus_one_trailing_rerun()
    {
        var (c, bridge, _, overlay) = Make();
        bridge.Gate = new TaskCompletionSource<bool>();

        var first = c.ScheduleRefreshAsync();
        for (var i = 0; i < 5; i++) await c.ScheduleRefreshAsync();
        bridge.Gate.SetResult(true);
        await first;

        Assert.Equal(2, bridge.DiffCalls);
        Assert.True(overlay.IsActive);
    }

    [Fact]
    public async Task A_failed_scheduled_run_does_not_wedge_the_single_flight_guard()
    {
        var (c, bridge, _, overlay) = Make();
        bridge.Gate = new TaskCompletionSource<bool>();
        var failing = c.ScheduleRefreshAsync();
        bridge.Gate.SetException(new InvalidOperationException("x"));
        await failing;
        bridge.Gate = null;

        await c.ScheduleRefreshAsync();

        Assert.True(overlay.IsActive);
    }

    [Fact]
    public async Task Accept_commits_closes_the_inline_view_and_refreshes_so_the_accepted_panel_disappears()
    {
        var (c, bridge, expansion, overlay) = Make();
        await c.RefreshAsync();

        var ok = await c.AcceptAsync(Fn);
        await c.PendingRefresh;

        Assert.True(ok);
        Assert.Equal(new[] { Fn }, bridge.Accepted);
        Assert.False(expansion.IsCodeVisible(Fn));
        Assert.Null(overlay.DiffOf(Fn));
        Assert.True(overlay.IsActive);
        Assert.False(c.IsAccepting);
    }

    [Fact]
    public async Task A_failed_accept_keeps_the_view_open_and_shows_the_error()
    {
        var (c, bridge, expansion, overlay) = Make();
        await c.RefreshAsync();
        bridge.AcceptFails = new InvalidOperationException("nothing to commit");

        var ok = await c.AcceptAsync(Fn);

        Assert.False(ok);
        Assert.Equal("nothing to commit", c.AcceptError);
        Assert.True(expansion.IsCodeVisible(Fn));
        Assert.NotNull(overlay.DiffOf(Fn));
    }
}

public class DiffModelTests
{
    public static TheoryData<string, string, string[]> Diffs => new()
    {
        { "a\nb\nc\n", "a\nB\nc\n", ["  a", "- b", "+ B", "  c"] },
        { "", "x\ny\n", ["+ x", "+ y"] },
        { "x\ny", "", ["- x", "- y"] },
        { "same\n", "same\n", ["  same"] },
        { "a\r\nb", "a\nb", ["  a", "  b"] },
    };

    [Theory, MemberData(nameof(Diffs))]
    public void Line_diff_marks_removed_added_and_context_lines(string original, string proposed, string[] expected)
    {
        var lines = LineDiff.Compute(original, proposed);

        Assert.Equal(expected, lines.Select(l => $"{l.Marker} {l.Text}"));
    }

    [Theory]
    [InlineData("src/a.py", "f", false, 3, 1, "src/a.py · f · +3 −1")]
    [InlineData("README.md", null, false, 2, 0, "README.md · +2 −0")]
    [InlineData("logo.png", null, true, 0, 0, "logo.png · binary")]
    public void A_card_s_meta_line_says_where_and_how_big_or_binary_instead_of_inventing_counts(string file, string? symbol, bool binary, int added, int removed, string expected)
    {
        var card = new ChangeCard { File = file, Symbol = symbol, Binary = binary, AddedLines = added, RemovedLines = removed };

        Assert.Equal(expected, card.Meta);
    }

    [Fact]
    public void The_overlay_groups_several_cards_on_one_node_and_clears_without_deactivating_other_state()
    {
        var overlay = new DiffOverlay();

        overlay.Publish([], [new ChangeCard { NodeId = "n" }, new ChangeCard { NodeId = "n" }, new ChangeCard { NodeId = "m" }], null);
        var grouped = overlay.CardsOf("n").Count;
        overlay.Clear();

        Assert.Equal(2, grouped);
        Assert.Empty(overlay.CardsOf("n"));
        Assert.False(overlay.IsActive);
        Assert.Empty(overlay.CardsOf("never-seen"));
    }
}

public class ChangeCardLayoutTests
{
    private static Rect? Rects(string id) => id switch { "a" => new Rect(0, 0, 240, 64), "b" => new Rect(0, 200, 240, 64), _ => null };

    [Fact]
    public void Several_cards_on_one_block_stack_in_one_panel_beside_it_with_a_connector_to_the_block()
    {
        var cards = new[] { new ChangeCard { NodeId = "a" }, new ChangeCard { NodeId = "a" } };

        var panel = Assert.Single(ChangeCardLayout.Place(cards, id => id, Rects));

        Assert.Equal(268, panel.Rect.Left);
        Assert.Equal(ChangeCardLayout.HeaderHeight + 2 * ChangeCardLayout.CardHeight, panel.Rect.Height);
        Assert.Equal("Changed here · 2 changes", panel.Title);
        Assert.Equal(240, panel.From.X);
        Assert.Equal(268, panel.To.X);
        Assert.False(panel.AncestorHint);
    }

    [Fact]
    public void A_card_hidden_by_a_collapsed_ancestor_lands_on_the_ancestor_with_a_hint_and_one_change_is_singular()
    {
        var cards = new[] { new ChangeCard { NodeId = "deep" } };

        var panel = Assert.Single(ChangeCardLayout.Place(cards, _ => "b", Rects));

        Assert.Equal("b", panel.NodeId);
        Assert.True(panel.AncestorHint);
        Assert.Equal("Changed here · 1 change", panel.Title);
    }

    [Fact]
    public void A_block_with_no_rectangle_gets_no_panel_and_two_blocks_get_two()
    {
        var cards = new[] { new ChangeCard { NodeId = "a" }, new ChangeCard { NodeId = "b" }, new ChangeCard { NodeId = "ghost" } };

        var panels = ChangeCardLayout.Place(cards, id => id, Rects);

        Assert.Equal(new[] { "a", "b" }, panels.Select(p => p.NodeId));
    }
}
