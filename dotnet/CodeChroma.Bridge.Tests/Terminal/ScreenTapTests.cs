using CodeChroma.Bridge.Terminal;

namespace CodeChroma.Bridge.Tests.Terminal;

public class ScreenTapTests
{
    private const string Esc = "\u001b";

    private static ScreenTap Tap(int rows = 5, int cols = 20) => new(rows, cols);

    [Fact]
    public void Plain_text_lands_on_the_first_row_and_trailing_blanks_are_trimmed()
    {
        var tap = Tap();

        tap.Feed("hello");

        Assert.Equal(["hello", "", "", "", ""], TopFirst(tap));
    }

    private static string[] TopFirst(ScreenTap tap) => [.. tap.Tail(5)];

    [Theory]
    [InlineData("one\r\ntwo\r\nthree", new[] { "one", "two", "three", "", "" })]
    [InlineData("abc" + "\b\bX", new[] { "aXc", "", "", "", "" })]
    [InlineData("abcdef" + Esc + "[3D" + "XY", new[] { "abcXYf", "", "", "", "" })]
    [InlineData("abcdef" + "\r" + "ZZ", new[] { "ZZcdef", "", "", "", "" })]
    [InlineData("aaaa" + Esc + "[2G" + "b", new[] { "abaa", "", "", "", "" })]
    [InlineData(Esc + "[3;4H" + "x", new[] { "", "", "   x", "", "" })]
    public void Cursor_movement_and_control_characters_place_text(string input, string[] expected)
    {
        var tap = Tap();

        tap.Feed(input);

        Assert.Equal(expected, TopFirst(tap));
    }

    [Fact]
    public void Erase_in_line_and_display_clear_what_they_say()
    {
        var tap = Tap();

        tap.Feed("abcdef\r\nghijkl" + Esc + "[3D" + Esc + "[K" + Esc + "[1;1H" + Esc + "[0K");

        Assert.Equal(["", "ghi", "", "", ""], TopFirst(tap));

        tap.Feed(Esc + "[2J");

        Assert.Equal(["", "", "", "", ""], TopFirst(tap));
    }

    [Fact]
    public void Output_past_the_last_row_scrolls_the_screen_up()
    {
        var tap = Tap(rows: 3);

        tap.Feed("a\r\nb\r\nc\r\nd");

        Assert.Equal(["b", "c", "d"], TopFirst3(tap));
    }

    private static string[] TopFirst3(ScreenTap tap) => [.. tap.Tail(3)];

    [Fact]
    public void Autowrap_continues_a_long_line_on_the_next_row()
    {
        var tap = Tap(rows: 3, cols: 5);

        tap.Feed("abcdefgh");

        Assert.Equal(["abcde", "fgh", ""], TopFirst3(tap));
    }

    [Fact]
    public void The_title_and_osc_progress_are_read_off_the_stream()
    {
        var tap = Tap();

        tap.Feed(Esc + "]0;⠇ working" + "\u0007" + Esc + "]9;4;1;40\u0007");

        Assert.Equal("⠇ working", tap.Title);
        Assert.Equal("running", tap.Progress);
    }

    [Theory]
    [InlineData("", "")]
    [InlineData("0", "none")]
    [InlineData("2", "error")]
    [InlineData("4", "warning")]
    public void Osc_progress_states_map_to_the_manifest_vocabulary(string state, string expected)
    {
        var tap = Tap();

        if (state.Length > 0) tap.Feed(Esc + "]9;4;" + state + Esc + "\\");

        Assert.Equal(expected, tap.Progress);
    }

    [Fact]
    public void Render_redraws_the_current_screen_from_a_cleared_state()
    {
        var tap = Tap();
        tap.Feed(Esc + "[31mred" + Esc + "[0m ok\r\nnext");

        var redraw = tap.Render();

        Assert.StartsWith(Esc + "[?25l" + Esc + "[H" + Esc + "[2J", redraw);
        Assert.Contains("red", redraw);
        Assert.Contains(Esc + "[0;31;49m" + "red", redraw);
        Assert.Contains("next", redraw);
        Assert.EndsWith(Esc + "[?25h", redraw);
    }

    [Fact]
    public void Render_leaves_the_cursor_hidden_when_the_program_hid_it()
    {
        var tap = Tap();
        tap.Feed("x" + Esc + "[?25l");

        Assert.DoesNotContain(Esc + "[?25h", tap.Render());
    }

    [Fact]
    public void Rendering_into_a_fresh_tap_reproduces_the_same_screen()
    {
        var source = Tap();
        source.Feed(Esc + "[1;32mbold" + Esc + "[0m\r\nplain " + Esc + "[7mrev" + Esc + "[0m\r\n" + Esc + "[3;10Hat");
        var replica = Tap();

        replica.Feed(source.Render());

        Assert.Equal(TopFirst(source), TopFirst(replica));
        Assert.Equal(source.Render(), replica.Render());
    }

    [Fact]
    public void A_reattach_replays_the_rows_that_scrolled_off_the_screen()
    {
        var source = Tap(rows: 3);
        source.Feed("one\r\ntwo\r\nthree\r\nfour\r\nfive");
        var replica = Tap(rows: 3);

        replica.Feed(source.Render());

        Assert.Equal(2, replica.HistoryCount);
        Assert.Equal(["three", "four", "five"], replica.Tail(3));
        Assert.Equal(source.Render(), replica.Render());
    }

    [Fact]
    public void History_wider_than_the_screen_is_rewrapped_to_the_current_width()
    {
        var source = Tap(rows: 2, cols: 10);
        source.Feed("0123456789\r\nx\r\ny");
        source.Resize(2, 5);
        var replica = Tap(rows: 2, cols: 5);

        replica.Feed(source.Render());

        Assert.Equal(2, replica.HistoryCount);
        Assert.Equal(["x", "y"], replica.Tail(2));
    }

    [Theory]
    [InlineData(Esc + "[3J")]
    [InlineData(Esc + "c")]
    public void Clearing_the_scrollback_drops_the_history(string clear)
    {
        var tap = Tap(rows: 2);
        tap.Feed("a\r\nb\r\nc\r\nd");

        tap.Feed(clear);

        Assert.Equal(0, tap.HistoryCount);
    }

    [Fact]
    public void The_alt_screen_keeps_no_history()
    {
        var tap = Tap(rows: 2);
        tap.Feed(Esc + "[?1049h");

        tap.Feed("a\r\nb\r\nc\r\nd");

        Assert.Equal(0, tap.HistoryCount);
        Assert.DoesNotContain("a\u001b[m\r\n", tap.Render());
    }

    [Fact]
    public void History_is_capped_at_the_xterm_scrollback()
    {
        var tap = Tap(rows: 1);

        tap.Feed(string.Concat(Enumerable.Repeat("x\r\n", ScreenTap.HistoryLimit + 10)));

        Assert.Equal(ScreenTap.HistoryLimit, tap.HistoryCount);
    }

    [Fact]
    public void Resizing_keeps_existing_rows_and_adds_blank_ones()
    {
        var tap = Tap(rows: 2, cols: 10);
        tap.Feed("keep");

        tap.Resize(4, 12);

        Assert.Equal(4, tap.Rows);
        Assert.Equal(12, tap.Cols);
        Assert.Contains("keep", tap.Tail(4));
    }

    [Fact]
    public void Garbage_and_truncated_sequences_never_throw()
    {
        var tap = Tap();

        var error = Record.Exception(() =>
        {
            tap.Feed(Esc + "[" + "9999999999999999999999;zz" + Esc + "]" + Esc + "(" + Esc);
            tap.Feed("\u0000\u0007\u007f");
        });

        Assert.Null(error);
    }

    [Fact]
    public void Tail_returns_only_the_bottom_rows()
    {
        var tap = Tap(rows: 4);
        tap.Feed("1\r\n2\r\n3\r\n4");

        Assert.Equal(["3", "4"], tap.Tail(2));
        Assert.Empty(tap.Tail(0));
    }
}
