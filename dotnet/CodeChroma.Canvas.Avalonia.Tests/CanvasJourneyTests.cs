using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using CodeChroma.Canvas.Avalonia;
using CodeChroma.Canvas.Model;
using CodeChroma.Canvas.State;

namespace CodeChroma.Canvas.Avalonia.Tests;

/// <summary>
/// Journey-level headless tests replacing the DOM-bound CanvasNodeBox/Block/Playwright assertions for the journeys that
/// exist in the Avalonia view: pan, zoom, culling, selection, multi-select and a collision-resolved drag.
/// </summary>
public class CanvasJourneyTests
{
    private static CanvasElement Box(string id, double x, double y, string label = "") =>
        new() { Id = id, Render = RenderKind.C1, Layer = "c1", Label = label == "" ? id : label, Position = new Position(x, y) };

    private static CanvasDoc DocOf(params CanvasElement[] elements) =>
        CanvasDoc.Empty with { Elements = elements.ToDictionary(e => e.Id) };

    private sealed class RecordingBridge : ICanvasBridge
    {
        public List<CanvasBatch> Patches { get; } = new();
        public Func<CanvasDoc> Canvas { get; set; } = () => CanvasDoc.Empty;
        public Task<CanvasDoc> GetCanvasAsync() => Task.FromResult(Canvas());
        public Task<BatchResult> PatchCanvasAsync(CanvasBatch batch) { Patches.Add(batch); return Task.FromResult(new BatchResult(true, Array.Empty<string>())); }
        public Task<RecipeRunResult> RunRecipeAsync(string name) => throw new NotSupportedException();
        public Task<bool> DeleteDiagramAsync(string kind) => throw new NotSupportedException();
    }

    private static (Window Window, CanvasView View, CanvasDocStore Store, RecordingBridge Bridge) Open(CanvasDoc doc)
    {
        var store = new CanvasDocStore();
        store.SetDoc(doc);
        var bridge = new RecordingBridge { Canvas = () => store.Doc };
        var view = new CanvasView(store, bridge);
        var window = new Window { Width = 800, Height = 600, Content = view };
        window.Show();
        return (window, view, store, bridge);
    }

    [AvaloniaFact]
    public void Dragging_empty_space_pans_the_camera()
    {
        var (window, view, _, _) = Open(DocOf(Box("a", 150, 36)));

        window.MouseDown(new Point(700, 500), MouseButton.Left);
        window.MouseMove(new Point(650, 450));
        window.MouseUp(new Point(650, 450), MouseButton.Left);

        Assert.Equal(-50, view.Viewport.State.X, 6);
        Assert.Equal(-50, view.Viewport.State.Y, 6);
    }

    [AvaloniaFact]
    public void The_wheel_zooms_around_the_cursor_and_keeps_the_point_under_it_fixed()
    {
        var (window, view, _, _) = Open(DocOf(Box("a", 150, 36)));
        var cursor = new Point(400, 300);
        var under = view.Viewport.ScreenToCanvas(new CodeChroma.Canvas.Geometry.Point(cursor.X, cursor.Y));

        window.MouseWheel(cursor, new Vector(0, 1));

        Assert.True(view.Viewport.State.Scale > 1);
        var after = view.Viewport.CanvasToScreen(under);
        Assert.Equal(cursor.X, after.X, 6);
        Assert.Equal(cursor.Y, after.Y, 6);
    }

    [AvaloniaFact]
    public void Only_the_boxes_on_screen_are_realised_out_of_two_thousand_and_a_pan_swaps_them()
    {
        var elements = Enumerable.Range(0, 2000).Select(i => Box($"n{i}", (i % 50) * 400 + 150, (i / 50) * 200 + 36)).ToArray();
        var (window, view, _, _) = Open(DocOf(elements));

        var first = view.RealisedIds.ToList();
        window.MouseDown(new Point(790, 590), MouseButton.Left);
        window.MouseMove(new Point(10, 10));
        window.MouseUp(new Point(10, 10), MouseButton.Left);
        var second = view.RealisedIds.ToList();

        Assert.InRange(first.Count, 1, 120);
        Assert.Contains("n0", first);
        Assert.NotEqual(first, second);
        Assert.InRange(second.Count, 1, 120);
    }

    [AvaloniaFact]
    public void Clicking_selects_a_box_ctrl_click_adds_and_clicking_empty_space_clears()
    {
        var (window, view, _, _) = Open(DocOf(Box("a", 150, 36), Box("b", 650, 36)));

        window.MouseDown(new Point(150, 36), MouseButton.Left);
        window.MouseUp(new Point(150, 36), MouseButton.Left);
        var one = view.Selection.OrderBy(x => x).ToArray();
        window.MouseDown(new Point(650, 36), MouseButton.Left, RawInputModifiers.Control);
        window.MouseUp(new Point(650, 36), MouseButton.Left, RawInputModifiers.Control);
        var two = view.Selection.OrderBy(x => x).ToArray();
        window.MouseDown(new Point(400, 500), MouseButton.Left);
        window.MouseUp(new Point(400, 500), MouseButton.Left);

        Assert.Equal(new[] { "a" }, one);
        Assert.Equal(new[] { "a", "b" }, two);
        Assert.Empty(view.Selection);
    }

    [AvaloniaFact]
    public void Dropping_a_box_onto_another_lands_it_clear_of_the_gap_and_persists_the_move()
    {
        var (window, view, store, bridge) = Open(DocOf(Box("a", 150, 36), Box("b", 650, 36)));

        window.MouseDown(new Point(150, 36), MouseButton.Left);
        window.MouseMove(new Point(400, 36));
        window.MouseMove(new Point(640, 40));
        window.MouseUp(new Point(640, 40), MouseButton.Left);
        Dispatcher_Flush();

        var a = view.Scene.RectOf("a");
        var b = view.Scene.RectOf("b");
        Assert.True(a.Right + 24 <= b.Left + 1e-6 || b.Right + 24 <= a.Left + 1e-6 || a.Bottom + 24 <= b.Top + 1e-6 || b.Bottom + 24 <= a.Top + 1e-6,
            $"a {a} still overlaps b {b}");
        Assert.NotEqual(new Position(150, 36), store.Doc.Elements["a"].Position);
        Assert.Contains(bridge.Patches, p => p.Ops.Any(o => o.Op == "update_element" && o.Id == "a"));
        Assert.Empty(view.DragOffsets.All);
    }

    [AvaloniaFact]
    public void A_locked_layout_box_is_never_dragged()
    {
        var epic = new CanvasElement { Id = "e", Render = RenderKind.Epic, Layer = "epics", Label = "EP-1", Position = new Position(100, 172) };
        var (window, _, store, bridge) = Open(DocOf(epic));

        window.MouseDown(new Point(150, 150), MouseButton.Left);
        window.MouseMove(new Point(300, 300));
        window.MouseUp(new Point(300, 300), MouseButton.Left);
        Dispatcher_Flush();

        Assert.Equal(new Position(100, 172), store.Doc.Elements["e"].Position);
        Assert.Empty(bridge.Patches);
    }

    [AvaloniaFact]
    public void Rendering_a_frame_with_edges_and_labels_does_not_throw()
    {
        var doc = DocOf(Box("a", 150, 36), Box("b", 650, 336)) with
        {
            Edges = new Dictionary<string, CanvasEdge> { ["x"] = new() { Id = "x", From = "a", To = "b", Label = "calls", Layer = "c1", Kind = "uses" } },
        };
        var (window, view, _, _) = Open(doc);

        var ex = Record.Exception(() => { window.UpdateLayout(); view.InvalidateVisual(); AvaloniaHeadlessPlatform.ForceRenderTimerTick(); });

        Assert.Null(ex);
        Assert.Single(view.RoutedEdges);
    }

    [AvaloniaFact]
    public void The_text_measurer_reports_taller_text_for_longer_descriptions()
    {
        var measurer = new AvaloniaTextMeasurer();

        var short1 = measurer.Measure("short", 200, 13);
        var long1 = measurer.Measure(string.Join(" ", Enumerable.Repeat("word", 80)), 200, 13);

        Assert.True(long1.Height > short1.Height, $"short={short1} long={long1}");
        Assert.True(measurer.LineHeight > 0);
    }

    [AvaloniaFact]
    public void Shift_dragging_over_empty_space_rubber_band_selects_the_boxes_it_touches_and_does_not_pan()
    {
        var (window, view, _, _) = Open(DocOf(Box("a", 150, 36), Box("b", 650, 36), Box("c", 150, 436)));

        window.MouseDown(new Point(790, 250), MouseButton.Left, RawInputModifiers.Shift);
        window.MouseMove(new Point(400, 150), RawInputModifiers.Shift);
        window.MouseMove(new Point(100, 10), RawInputModifiers.Shift);
        var live = view.MarqueeCanvasRect;
        window.MouseUp(new Point(100, 10), MouseButton.Left, RawInputModifiers.Shift);

        Assert.NotNull(live);
        Assert.Null(view.MarqueeCanvasRect);
        Assert.Equal(new[] { "a", "b" }, view.Selection.OrderBy(x => x).ToArray());
        Assert.Equal(0, view.Viewport.State.X);
    }

    [AvaloniaFact]
    public void Escape_clears_the_selection()
    {
        var (window, view, _, _) = Open(DocOf(Box("a", 150, 36)));
        window.MouseDown(new Point(150, 36), MouseButton.Left);
        window.MouseUp(new Point(150, 36), MouseButton.Left);
        view.Focus();

        window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);

        Assert.Empty(view.Selection);
    }

    [AvaloniaFact]
    public void Dragging_one_of_a_multi_selection_moves_all_by_the_same_delta_in_one_batch_and_Ctrl_Z_undoes_it_as_one_step()
    {
        var (window, view, store, bridge) = Open(DocOf(Box("a", 150, 36), Box("b", 650, 36)));
        window.MouseDown(new Point(790, 250), MouseButton.Left, RawInputModifiers.Shift);
        window.MouseMove(new Point(100, 10), RawInputModifiers.Shift);
        window.MouseUp(new Point(100, 10), MouseButton.Left, RawInputModifiers.Shift);

        window.MouseDown(new Point(150, 36), MouseButton.Left);
        window.MouseMove(new Point(200, 70));
        window.MouseMove(new Point(250, 136));
        window.MouseUp(new Point(250, 136), MouseButton.Left);
        Dispatcher_Flush();
        var moved = (store.Doc.Elements["a"].Position, store.Doc.Elements["b"].Position);
        view.Focus();
        window.KeyPress(Key.Z, RawInputModifiers.Control, PhysicalKey.Z, "z");
        Dispatcher_Flush();

        Assert.Equal(new Position(250, 136), moved.Item1);
        Assert.Equal(new Position(750, 136), moved.Item2);
        Assert.Equal(2, bridge.Patches[0].Ops.Count);
        Assert.Equal(new Position(150, 36), store.Doc.Elements["a"].Position);
        Assert.Equal(new Position(650, 36), store.Doc.Elements["b"].Position);
        Assert.False(view.Undo.CanUndo("canvas"));
    }

    [AvaloniaFact]
    public void Undo_with_nothing_recorded_changes_nothing_and_a_pure_click_records_nothing()
    {
        var (window, view, store, bridge) = Open(DocOf(Box("a", 150, 36)));
        window.MouseDown(new Point(150, 36), MouseButton.Left);
        window.MouseUp(new Point(150, 36), MouseButton.Left);

        var undone = view.UndoMove();

        Assert.False(undone);
        Assert.Empty(bridge.Patches);
        Assert.Equal(new Position(150, 36), store.Doc.Elements["a"].Position);
    }

    private static void Dispatcher_Flush() => global::Avalonia.Threading.Dispatcher.UIThread.RunJobs();
}
