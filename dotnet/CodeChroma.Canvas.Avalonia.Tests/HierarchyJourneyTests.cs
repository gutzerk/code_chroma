using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using CodeChroma.Canvas.Highlighting;
using CodeChroma.Canvas.Hierarchy;
using CodeChroma.Canvas.State;
using CodeChroma.Core;

namespace CodeChroma.Canvas.Avalonia.Tests;

/// <summary>
/// Headless replacements for the Playwright journeys expand-in-place, multi-expand-collapse, multi-select (the canvas half),
/// block-collision and code-popup-resize, plus the vitest rubber-band / group-drag / undo / CodePopup behaviour, driven by the
/// C# graph core's real output for the shared sample repo.
/// </summary>
public class HierarchyJourneyTests
{
    private const string Billing = "dir::billing", Shared = "dir::shared", Users = "dir::users";
    private const string Reporter = "component::billing/reporter.go";
    private const string RenderReport = "billing/reporter.go::function::RenderReport";
    private const string RenderCode = "func RenderReport() { return \"x\" } // done";

    private sealed class Memory : IKeyValueStore
    {
        public Dictionary<string, string> Data { get; } = new();
        public string? Get(string key) => Data.GetValueOrDefault(key);
        public void Set(string key, string value) => Data[key] = value;
    }

    private static Graph SampleGraph()
    {
        var core = new GraphCore();
        core.Analyze(AnalysisInputReader.Load(Path.Combine(AppContext.BaseDirectory, "fixtures", "sample_repo.input.json")));
        return core.Snapshot;
    }

    private static (Window Window, HierarchyCanvas Canvas, HierarchyView View, Memory Storage) Open(Memory? storage = null)
    {
        var graph = SampleGraph();
        var symbol = graph.Symbols[RenderReport];
        var file = string.Join("\n", Enumerable.Range(1, 60).Select(i => i == symbol.StartLine ? RenderCode : $"x := {i}"));
        storage ??= new Memory();
        var canvas = new HierarchyCanvas(new CoreHierarchySource(graph), new CoreCodeSource(graph, path => path == symbol.FilePath ? file : null), storage);
        var window = new Window { Width = 800, Height = 600, Content = canvas };
        window.Show();
        return (window, canvas, canvas.View, storage);
    }

    private static Point Screen(HierarchyView view, string id, double dx = 40, double dy = 16)
    {
        var r = view.RectOf(id);
        var p = view.Viewport.CanvasToScreen(new CodeChroma.Canvas.Geometry.Point(r.Left + dx, r.Top + dy));
        return new Point(p.X, p.Y);
    }

    private static void Reveal(HierarchyView view, string id)
    {
        var r = view.RectOf(id);
        var at = view.Viewport.CanvasToScreen(new CodeChroma.Canvas.Geometry.Point(r.Left, r.Top));
        view.Viewport.Pan(60 - at.X, 60 - at.Y);
    }

    private static void Click(Window w, Point p, RawInputModifiers m = RawInputModifiers.None)
    {
        w.MouseDown(p, MouseButton.Left, m);
        w.MouseUp(p, MouseButton.Left, m);
        Dispatcher.UIThread.RunJobs();
    }

    private static void Drag(Window w, Point from, Point to, RawInputModifiers m = RawInputModifiers.None)
    {
        w.MouseDown(from, MouseButton.Left, m);
        w.MouseMove(new Point((from.X + to.X) / 2, (from.Y + to.Y) / 2), m);
        w.MouseMove(to, m);
        w.MouseUp(to, MouseButton.Left, m);
        Dispatcher.UIThread.RunJobs();
    }

    private static void Undo(Window w) => w.KeyPress(Key.Z, RawInputModifiers.Control, PhysicalKey.Z, "z");

    private static bool Apart(global::CodeChroma.Canvas.Geometry.Rect a, global::CodeChroma.Canvas.Geometry.Rect b) =>
        a.Right <= b.Left || b.Right <= a.Left || a.Bottom <= b.Top || b.Bottom <= a.Top;

    // ---- expand-in-place.spec.ts + multi-expand-collapse.spec.ts -------------------------------------------------

    [AvaloniaFact]
    public void The_canvas_opens_with_the_real_top_level_systems_collapsed()
    {
        var (_, _, view, _) = Open();

        var names = view.Scene.Boxes.Select(b => b.Item.Name);

        Assert.Equal(new[] { "billing", "shared", "users", "web" }, names);
        Assert.All(view.Scene.Boxes, b => Assert.False(b.Expanded));
    }

    [AvaloniaFact]
    public void Clicking_down_from_a_system_to_a_function_expands_in_place_and_every_ancestor_stays_open()
    {
        var (window, _, view, _) = Open();
        var path = new[] { Billing, Reporter, "service::billing/reporter.go::functions" };

        foreach (var id in path)
        {
            Reveal(view, id);
            Click(window, Screen(view, id));
        }

        Assert.All(path, id => Assert.True(view.Expansion.IsExpanded(id), id));
        Assert.NotNull(view.Scene.Find(RenderReport));
        Assert.Equal(3, view.Scene.Find(RenderReport)!.Depth);
        Assert.All(path, id => Assert.True(Contains(view.RectOf(id), view.RectOf(RenderReport))));
    }

    [AvaloniaFact]
    public void Siblings_expand_and_collapse_independently_at_different_depths()
    {
        var (window, _, view, _) = Open();
        Reveal(view, Billing); Click(window, Screen(view, Billing));
        Reveal(view, Reporter); Click(window, Screen(view, Reporter));
        var service = "billing/service.py";
        var serviceNode = "component::" + service;
        Reveal(view, serviceNode); Click(window, Screen(view, serviceNode));

        Reveal(view, Reporter); Click(window, Screen(view, Reporter));

        Assert.False(view.Expansion.IsExpanded(Reporter));
        Assert.True(view.Expansion.IsExpanded(serviceNode));
        Assert.True(view.Expansion.IsExpanded(Billing));
    }

    private sealed class TinySource : IHierarchySource
    {
        private readonly HierarchyItem _leaf = new("leaf", "leaf", "function", HierarchyIds.Root, false);
        private readonly HierarchyItem _described = new("described", "described", "function", HierarchyIds.Root, false, "what it does");
        public HierarchyItem? Get(string id) => new[] { _leaf, _described }.FirstOrDefault(i => i.Id == id);
        public IReadOnlyList<HierarchyItem> Children(string id) => id == HierarchyIds.Root ? new[] { _leaf, _described } : [];
    }

    [AvaloniaFact]
    public void A_leaf_with_no_children_and_no_description_does_not_expand_but_a_described_one_reveals_its_description()
    {
        var canvas = new HierarchyCanvas(new TinySource());
        var window = new Window { Width = 800, Height = 600, Content = canvas };
        window.Show();
        var view = canvas.View;

        Click(window, Screen(view, "leaf"));
        Click(window, Screen(view, "described"));

        Assert.False(view.Expansion.IsExpanded("leaf"));
        Assert.True(view.Expansion.IsExpanded("described"));
    }

    [AvaloniaFact]
    public void Collapsing_a_system_closes_everything_below_it_and_the_open_set_survives_a_reload()
    {
        var (window, _, view, storage) = Open();
        Reveal(view, Billing); Click(window, Screen(view, Billing));
        Reveal(view, Reporter); Click(window, Screen(view, Reporter));

        var reopened = Open(storage).View;

        Assert.True(reopened.Expansion.Restored);
        Assert.True(reopened.Expansion.IsExpanded(Reporter));
        Reveal(view, Billing); Click(window, Screen(view, Billing));
        Assert.Empty(view.Expansion.ExpandedOrder);
    }

    // ---- multi-select + rubber band --------------------------------------------------------------------------------

    [AvaloniaFact]
    public void Shift_or_ctrl_clicking_a_system_selects_it_without_expanding_and_a_plain_click_clears_then_expands()
    {
        var (window, _, view, _) = Open();

        Click(window, Screen(view, Billing), RawInputModifiers.Shift);
        Click(window, Screen(view, Shared), RawInputModifiers.Control);
        var selected = view.Selection.Ids.ToArray();
        var expandedWhileSelecting = view.Expansion.ExpandedOrder.Count;
        Click(window, Screen(view, Users));

        Assert.Equal(new[] { Billing, Shared }, selected);
        Assert.Equal(0, expandedWhileSelecting);
        Assert.Equal(0, view.Selection.Count);
        Assert.True(view.Expansion.IsExpanded(Users));
    }

    [AvaloniaFact]
    public void Shift_dragging_over_empty_canvas_draws_a_rubber_band_that_selects_every_system_it_touches()
    {
        var (window, _, view, _) = Open();

        Drag(window, new Point(650, 120), new Point(5, 5), RawInputModifiers.Shift);

        Assert.Equal(new[] { Billing, Shared }.OrderBy(x => x), view.Selection.Ids.OrderBy(x => x));
        Assert.Null(view.MarqueeCanvasRect);
        Assert.Equal(0, view.Viewport.State.X - 20);
    }

    [AvaloniaFact]
    public void A_second_shift_marquee_extends_the_selection_and_Escape_clears_it()
    {
        var (window, _, view, _) = Open();
        Drag(window, new Point(650, 120), new Point(300, 5), RawInputModifiers.Shift);
        var first = view.Selection.Ids.ToArray();

        Drag(window, new Point(300, 340), new Point(20, 250), RawInputModifiers.Shift);
        var second = view.Selection.Ids.OrderBy(x => x).ToArray();
        view.Focus();
        window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);

        Assert.Equal(new[] { Shared }, first);
        Assert.Equal(new[] { Shared, Users }.OrderBy(x => x), second);
        Assert.Equal(0, view.Selection.Count);
    }

    [AvaloniaFact]
    public void A_plain_drag_over_empty_canvas_still_pans_instead_of_selecting()
    {
        var (window, _, view, _) = Open();

        Drag(window, new Point(700, 500), new Point(650, 450));

        Assert.Equal(-30, view.Viewport.State.X);
        Assert.Equal(0, view.Selection.Count);
    }

    // ---- group drag, collision, undo ---------------------------------------------------------------------------------

    [AvaloniaFact]
    public void Dragging_one_selected_system_moves_the_whole_selection_by_the_same_delta_with_no_collision_settling()
    {
        var (window, _, view, _) = Open();
        Drag(window, new Point(650, 120), new Point(5, 5), RawInputModifiers.Shift);
        var before = new[] { Billing, Shared }.ToDictionary(id => id, id => view.RectOf(id));

        Drag(window, Screen(view, Billing), new Point(Screen(view, Billing).X + 100, Screen(view, Billing).Y + 40));

        foreach (var id in new[] { Billing, Shared })
        {
            Assert.Equal(before[id].Left + 100, view.RectOf(id).Left, 6);
            Assert.Equal(before[id].Top + 40, view.RectOf(id).Top, 6);
        }
        Assert.Equal(new[] { Billing, Shared }.OrderBy(x => x), view.Selection.Ids.OrderBy(x => x));
        Assert.Empty(view.DragOffsets.All);
    }

    [AvaloniaFact]
    public void Dropping_a_system_onto_a_neighbour_settles_it_clear_of_the_neighbour_and_persists_the_position()
    {
        var (window, _, view, storage) = Open();
        var from = Screen(view, Billing);
        var onto = Screen(view, Shared);

        Drag(window, from, new Point(onto.X, onto.Y + 4));

        Assert.True(Apart(view.RectOf(Billing), view.RectOf(Shared)), $"{view.RectOf(Billing)} overlaps {view.RectOf(Shared)}");
        Assert.True(view.Layout.Positions.ContainsKey(Billing));
        Assert.Contains(storage.Data, kv => kv.Key.StartsWith("codechroma.hierarchyLayout") && kv.Value.Contains(Billing));
        Assert.Equal(Billing, Assert.Single(view.Selection.Ids));
    }

    [AvaloniaFact]
    public void Ctrl_Z_undoes_a_group_drag_as_one_step_and_a_second_Ctrl_Z_does_nothing()
    {
        var (window, _, view, _) = Open();
        var start = new[] { Billing, Shared }.ToDictionary(id => id, id => view.RectOf(id));
        Drag(window, new Point(650, 120), new Point(5, 5), RawInputModifiers.Shift);
        Drag(window, Screen(view, Billing), new Point(Screen(view, Billing).X + 100, Screen(view, Billing).Y + 40));
        view.Focus();

        Undo(window);
        var afterUndo = new[] { Billing, Shared }.ToDictionary(id => id, id => view.RectOf(id));
        Undo(window);

        foreach (var id in start.Keys) Assert.Equal(start[id], afterUndo[id]);
        Assert.False(view.Undo.CanUndo("hierarchy"));
        Assert.Equal(start[Billing], view.RectOf(Billing));
    }

    [AvaloniaFact]
    public void A_click_without_movement_records_nothing_to_undo()
    {
        var (window, _, view, _) = Open();

        Click(window, Screen(view, Billing));

        Assert.False(view.Undo.CanUndo("hierarchy"));
    }

    // ---- code popup (CodePopup.test.tsx + code-popup-resize.spec.ts) -------------------------------------------------

    private static (Window Window, HierarchyCanvas Canvas, HierarchyView View) OpenFunctionPopup()
    {
        var (window, canvas, view, _) = Open();
        foreach (var id in new[] { Billing, Reporter, "service::billing/reporter.go::functions" })
        {
            Reveal(view, id);
            Click(window, Screen(view, id));
        }
        Reveal(view, RenderReport);
        var button = view.CodeButtonRect(RenderReport)!.Value;
        var center = view.Viewport.CanvasToScreen(new CodeChroma.Canvas.Geometry.Point(button.CenterX, button.CenterY));
        Click(window, new Point(center.X, center.Y));
        canvas.UpdateLayout();
        return (window, canvas, view);
    }

    [AvaloniaFact]
    public void The_code_button_opens_a_popup_with_the_function_title_and_highlighted_source_instead_of_expanding()
    {
        var (_, canvas, view) = OpenFunctionPopup();

        var popup = canvas.Popup!;
        var runs = popup.SourceBlock.Inlines!.OfType<Run>().ToList();

        Assert.NotNull(popup);
        Assert.Contains("RenderReport", popup.TitleText.Text);
        Assert.Equal(RenderCode, string.Concat(runs.Select(r => r.Text)).Split('\n')[0]);
        Assert.Contains(runs, r => r.Text == "func" && Equals(r.Foreground, CodeBrushes.For(TokenKind.Keyword)));
        Assert.Contains(runs, r => r.Text == "\"x\"" && Equals(r.Foreground, CodeBrushes.For(TokenKind.String)));
        Assert.Contains(runs, r => r.Text == "// done" && Equals(r.Foreground, CodeBrushes.For(TokenKind.Comment)));
        Assert.False(view.Expansion.IsExpanded(RenderReport));
    }

    [AvaloniaTheory]
    [InlineData("escape")]
    [InlineData("close-button")]
    [InlineData("backdrop")]
    public void The_popup_closes_from_Escape_the_close_button_or_a_backdrop_click_but_not_from_a_click_inside_the_panel(string how)
    {
        var (window, canvas, _) = OpenFunctionPopup();
        var insidePanel = canvas.Popup!.Panel.TranslatePoint(new Point(100, 100), window)!.Value;
        Click(window, insidePanel);
        var stillOpen = canvas.Popup is not null;

        switch (how)
        {
            case "escape": window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null); break;
            case "close-button": Click(window, canvas.Popup!.CloseButton.TranslatePoint(new Point(10, 10), window)!.Value); break;
            default: Click(window, new Point(5, 5)); break;
        }
        Dispatcher.UIThread.RunJobs();

        Assert.True(stillOpen);
        Assert.Null(canvas.Popup);
    }

    [AvaloniaFact]
    public void Dragging_the_title_bar_moves_the_panel_a_tiny_movement_does_not_and_the_close_button_is_not_a_handle()
    {
        var (window, canvas, _) = OpenFunctionPopup();
        var popup = canvas.Popup!;
        var grip = popup.TitleBar.TranslatePoint(new Point(60, 12), window)!.Value;

        Drag(window, grip, new Point(grip.X + 1, grip.Y + 1));
        var tiny = popup.Shift;
        Drag(window, grip, new Point(grip.X + 40, grip.Y + 30));
        var moved = popup.Shift;

        Assert.Equal(new Point(0, 0), tiny);
        Assert.Equal(40, moved.X, 6);
        Assert.Equal(30, moved.Y, 6);
        Assert.NotNull(canvas.Popup);
    }

    [AvaloniaFact]
    public void The_corner_handle_grows_the_panel_by_the_drag_delta_and_never_shrinks_it_below_the_minimum()
    {
        var (window, canvas, _) = OpenFunctionPopup();
        var popup = canvas.Popup!;
        var handle = popup.ResizeHandle.TranslatePoint(new Point(8, 8), window)!.Value;
        var before = new Size(popup.Panel.Width, popup.Panel.Height);

        Drag(window, handle, new Point(handle.X + 30, handle.Y + 20));
        var grown = new Size(popup.Panel.Width, popup.Panel.Height);
        var handle2 = popup.ResizeHandle.TranslatePoint(new Point(8, 8), window)!.Value;
        Drag(window, handle2, new Point(handle2.X - 2000, handle2.Y - 2000));

        Assert.Equal(CodePopup.DefaultWidth, before.Width);
        Assert.Equal(before.Width + 30, grown.Width, 6);
        Assert.Equal(before.Height + 20, grown.Height, 6);
        Assert.Equal(CodePopup.MinPanelWidth, popup.Panel.Width);
        Assert.Equal(CodePopup.MinPanelHeight, popup.Panel.Height);
    }

    [AvaloniaFact]
    public void Inline_mode_shows_the_code_inside_the_block_and_hides_its_children_until_toggled_back()
    {
        var (window, _, view, _) = Open();
        view.CodeMode = CodeViewMode.Inline;
        foreach (var id in new[] { Billing, Reporter, "service::billing/reporter.go::functions", RenderReport })
        {
            Reveal(view, id);
            Click(window, Screen(view, id));
        }
        var childBefore = view.Scene.Find("logicblock::billing/reporter.go::function::RenderReport::0");
        Reveal(view, RenderReport);
        var button = view.CodeButtonRect(RenderReport)!.Value;
        var at = view.Viewport.CanvasToScreen(new CodeChroma.Canvas.Geometry.Point(button.CenterX, button.CenterY));

        Click(window, new Point(at.X, at.Y));
        var open = view.Scene.Find(RenderReport)!;
        var childDuring = view.Scene.Find("logicblock::billing/reporter.go::function::RenderReport::0");
        var again = view.CodeButtonRect(RenderReport)!.Value;
        var back = view.Viewport.CanvasToScreen(new CodeChroma.Canvas.Geometry.Point(again.CenterX, again.CenterY));
        Click(window, new Point(back.X, back.Y));

        Assert.NotNull(childBefore);
        Assert.True(open.CodeOpen);
        Assert.Null(childDuring);
        Assert.NotNull(view.Scene.Find("logicblock::billing/reporter.go::function::RenderReport::0"));
    }

    [AvaloniaFact]
    public void Clicking_a_block_body_while_its_code_is_open_neither_closes_it_nor_toggles_expansion()
    {
        var (window, _, view, _) = Open();
        view.Expansion.Expand(Billing);
        view.Expansion.ShowCode(Reporter);
        Reveal(view, Reporter);

        Click(window, Screen(view, Reporter));

        Assert.True(view.Expansion.IsCodeVisible(Reporter));
        Assert.False(view.Expansion.IsExpanded(Reporter));
    }

    [AvaloniaTheory]
    [InlineData(RawInputModifiers.Control, true)]
    [InlineData(RawInputModifiers.Meta, true)]
    [InlineData(RawInputModifiers.None, false)]
    [InlineData(RawInputModifiers.Shift, false)]
    public void Only_Ctrl_or_Cmd_with_Z_undoes_a_move_plain_Z_and_other_modifiers_do_nothing(RawInputModifiers modifiers, bool undoes)
    {
        var (window, _, view, _) = Open();
        var start = view.RectOf(Billing);
        Drag(window, Screen(view, Billing), new Point(Screen(view, Billing).X + 120, Screen(view, Billing).Y + 50));
        var moved = view.RectOf(Billing);
        view.Focus();

        window.KeyPress(Key.Z, modifiers, PhysicalKey.Z, "z");

        Assert.NotEqual(start, moved);
        Assert.Equal(undoes ? start : moved, view.RectOf(Billing));
    }

    [AvaloniaFact]
    public void Rendering_a_frame_with_nested_blocks_selection_inline_code_and_a_band_does_not_throw()
    {
        var (window, _, view, _) = Open();
        foreach (var id in new[] { Billing, Reporter, "service::billing/reporter.go::functions", RenderReport })
        {
            Reveal(view, id);
            Click(window, Screen(view, id));
        }
        view.Expansion.ShowCode(RenderReport);
        view.Selection.Replace([Billing]);
        view.FitAll();

        var ex = Record.Exception(() => { window.UpdateLayout(); view.InvalidateVisual(); AvaloniaHeadlessPlatform.ForceRenderTimerTick(); });

        Assert.Null(ex);
        Assert.NotEmpty(view.RealisedBoxes);
    }

    private static bool Contains(global::CodeChroma.Canvas.Geometry.Rect outer, global::CodeChroma.Canvas.Geometry.Rect inner) =>
        inner.Left >= outer.Left && inner.Top >= outer.Top && inner.Right <= outer.Right + 1e-6 && inner.Bottom <= outer.Bottom + 1e-6;
}
