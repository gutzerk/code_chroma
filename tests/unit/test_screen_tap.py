"""ScreenTap: the rendered screen, the OSC title, and OSC 9;4 progress read off a PTY stream."""

from codechroma.terminal.screen_tap import PROGRESS_NONE, PROGRESS_UNKNOWN, ScreenTap


def test_the_tail_is_the_rendered_screen_not_the_raw_stream():
    tap = ScreenTap(rows=4, cols=20)

    tap.feed("first line\r\nsecond line\r\n")
    tap.feed("\x1b[H\x1b[2Jrepainted\r\n")

    assert tap.tail(4) == ["repainted", "", "", ""]


def test_a_cursor_jump_overwrites_in_place_rather_than_appending():
    tap = ScreenTap(rows=3, cols=20)

    tap.feed("thinking...")
    tap.feed("\r" + " " * 11 + "\rdone")

    assert tap.tail(3) == ["done", "", ""]


def test_the_title_comes_from_osc_2():
    tap = ScreenTap()

    tap.feed("\x1b]2;⠹ Claude\x07")

    assert tap.title == "⠹ Claude"


def test_progress_is_unknown_until_the_process_actually_reports_it():
    tap = ScreenTap()

    tap.feed("plain output with no OSC at all\r\n")

    assert tap.progress == PROGRESS_UNKNOWN


def test_osc_9_4_progress_is_captured_even_though_pyte_drops_it():
    tap = ScreenTap()

    tap.feed("\x1b]9;4;1;40\x07working")

    assert tap.progress == "running"


def test_the_last_progress_state_in_a_chunk_wins():
    tap = ScreenTap()

    tap.feed("\x1b]9;4;1;40\x07\x1b]9;4;0\x07")

    assert tap.progress == PROGRESS_NONE


def test_feeding_garbage_never_raises():
    tap = ScreenTap()

    tap.feed("\x1b[?9999;9999z\x1b]\x1b\\\x00\xff")

    assert isinstance(tap.tail(2), list)


def test_resize_changes_how_many_rows_the_tail_can_report():
    tap = ScreenTap(rows=4, cols=20)

    tap.resize(10, 40)
    tap.feed("hello\r\n")

    assert len(tap.tail(10)) == 10


def test_the_render_redraws_the_current_screen_rather_than_replaying_the_stream():
    tap = ScreenTap(rows=3, cols=20)

    tap.feed("first\r\nsecond\r\n")
    tap.feed("\x1b[H\x1b[2Jrepainted")

    assert "repainted" in tap.render()
    assert "first" not in tap.render()


def test_the_render_clears_first_so_it_cannot_inherit_the_previous_screen():
    tap = ScreenTap(rows=2, cols=10)

    tap.feed("hello")

    assert tap.render().startswith("\x1b[?25l\x1b[H\x1b[2J\x1b[3J\x1b[m")


def test_the_render_carries_colour_so_a_reattach_is_not_monochrome():
    tap = ScreenTap(rows=2, cols=20)

    tap.feed("\x1b[31mred\x1b[0m")

    assert "\x1b[0;31;49mred" in tap.render()
