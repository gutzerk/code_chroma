using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Threading;
using CodeChroma.Canvas.Diff;
using CodeChroma.Canvas.Hierarchy;
using CodeChroma.Core;

namespace CodeChroma.Canvas.Avalonia.Tests;

/// <summary>
/// Headless replacements for global-diff.spec.ts, diff-accept.spec.ts and change-cards.spec.ts (all test.skip in Playwright
/// because the Diff rail button was pulled): toggle on reveals and recolors, off restores, cards dedupe, Accept commits.
/// </summary>
public class DiffJourneyTests
{
    private const string Billing = "dir::billing";
    private const string CreateInvoice = "billing/service.py::function::BillingService.create_invoice";
    private const string InvoiceClass = "billing/models/invoice.py::class::Invoice";
    private const string UsersFile = "component::users/service.py";

    private sealed class FakeBridge : IDiffBridge
    {
        public List<FunctionDiff> Diffs { get; set; } = [
            new FunctionDiff { NodeId = CreateInvoice, OriginalSource = "def create_invoice(self):\n    return 1\n", ProposedSource = "def create_invoice(self):\n    return 2\n", Status = "modified" },
        ];
        public ChangeCardSet Cards { get; set; } = new()
        {
            Cards = [
                new ChangeCard { NodeId = CreateInvoice, Kind = "modify", Text = "create_invoice changed", File = "billing/service.py", AddedLines = 1, RemovedLines = 1 },
                new ChangeCard { NodeId = InvoiceClass, Kind = "modify", Text = "Invoice changed", File = "billing/models/invoice.py", Symbol = "Invoice", AddedLines = 2, RemovedLines = 0 },
                new ChangeCard { NodeId = UsersFile, Kind = "add", Text = "users/service.py added", File = "users/service.py", Status = "added", AddedLines = 9 },
            ],
            ByNodeStatus = new() { [CreateInvoice] = "modified", [InvoiceClass] = "modified", [UsersFile] = "added" },
        };
        public TaskCompletionSource<bool>? Gate { get; set; }
        public List<string> Accepted { get; } = new();

        public async Task<IReadOnlyList<FunctionDiff>> GetDiffAsync(CancellationToken ct)
        {
            if (Gate is not null) await Gate.Task.WaitAsync(ct);
            return Diffs.ToList();
        }

        public Task<ChangeCardSet?> GetChangeCardsAsync(CancellationToken ct) => Task.FromResult<ChangeCardSet?>(Cards);

        public Task AcceptAsync(string nodeId, CancellationToken ct)
        {
            Accepted.Add(nodeId);
            Diffs.RemoveAll(d => d.NodeId == nodeId);
            return Task.CompletedTask;
        }
    }

    private static (Window Window, HierarchyCanvas Canvas, HierarchyView View, DiffController Controller, DiffToggleButton Button, FakeBridge Bridge) Open(bool readOnly = false)
    {
        var core = new GraphCore();
        core.Analyze(AnalysisInputReader.Load(Path.Combine(AppContext.BaseDirectory, "fixtures", "sample_repo.input.json")));
        var graph = core.Snapshot;
        var source = new CoreHierarchySource(graph);
        var code = new CoreCodeSource(graph, _ => string.Join("\n", Enumerable.Range(1, 60).Select(i => $"line {i}")));
        var canvas = new HierarchyCanvas(source, code) { ReadOnly = readOnly };
        var bridge = new FakeBridge();
        var controller = new DiffController(bridge, source, canvas.Expansion, new DiffOverlay());
        canvas.AttachDiff(controller);
        var button = new DiffToggleButton(controller) { VerticalAlignment = VerticalAlignment.Bottom, HorizontalAlignment = HorizontalAlignment.Left };
        var window = new Window { Width = 1400, Height = 900, Content = new Grid { Children = { canvas, button } } };
        window.Show();
        window.UpdateLayout();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick();
        return (window, canvas, canvas.View, controller, button, bridge);
    }

    private static void Press(Window window, Control target)
    {
        window.UpdateLayout();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick();
        var p = target.TranslatePoint(new Point(target.Bounds.Width / 2, target.Bounds.Height / 2), window)!.Value;
        var clicks = 0; if (target is Button b) b.Click += (_, _) => clicks++;
        window.MouseDown(p, MouseButton.Left);
        window.MouseUp(p, MouseButton.Left);
        Settle();
        if (clicks == 0) throw new Exception($"NOCLICK at {p} bounds {target.Bounds} win {window.ClientSize}");
    }

    private static void Settle()
    {
        for (var i = 0; i < 5; i++) Dispatcher.UIThread.RunJobs();
    }

    private static void ClickAt(Window window, HierarchyView view, global::CodeChroma.Canvas.Geometry.Point canvasPoint)
    {
        var p = view.Viewport.CanvasToScreen(canvasPoint);
        window.MouseDown(new Point(p.X, p.Y), MouseButton.Left);
        window.MouseUp(new Point(p.X, p.Y), MouseButton.Left);
        Settle();
    }

    [AvaloniaFact]
    public void The_Diff_button_reveals_the_changed_function_with_its_diff_recolors_blocks_and_pins_cards()
    {
        var (window, _, view, controller, button, _) = Open();
        var before = button.Label;

        Press(window, button);

        Assert.Equal(DiffToggleButton.OffLabel, before);
        Assert.Equal(DiffToggleButton.OnLabel, button.Label);
        Assert.True(view.Expansion.IsExpanded(Billing));
        var box = view.Scene.Find(CreateInvoice)!;
        Assert.True(box.CodeOpen);
        Assert.NotNull(view.Diff!.DiffOf(CreateInvoice));
        Assert.Equal("modified", view.Diff.StatusOf(CreateInvoice));
        Assert.Equal("added", view.Diff.StatusOf(UsersFile));
        Assert.Null(controller.LastError);
    }

    [AvaloniaFact]
    public void A_change_whose_block_already_shows_a_diff_gets_no_duplicate_card_and_cards_sit_beside_their_blocks()
    {
        var (window, _, view, _, button, _) = Open();

        Press(window, button);
        var panels = view.ChangeCardPanels;

        Assert.DoesNotContain(panels.SelectMany(p => p.Cards), c => c.NodeId == CreateInvoice);
        var invoice = Assert.Single(panels, p => p.NodeId == InvoiceClass || p.Cards.Any(c => c.NodeId == InvoiceClass));
        var block = view.RectOf(invoice.NodeId);
        Assert.True(invoice.Rect.Left > block.Right);
        Assert.Equal(block.Right, invoice.From.X, 6);
        Assert.Equal(invoice.Rect.Left, invoice.To.X, 6);
    }

    [AvaloniaFact]
    public void A_card_on_a_collapsed_system_s_hidden_child_pins_to_the_system_with_a_hint()
    {
        var (window, _, view, controller, button, _) = Open();
        Press(window, button);

        view.Expansion.Collapse("dir::users");
        var users = view.ChangeCardPanels.Single(p => p.Cards.Any(c => c.NodeId == UsersFile));

        Assert.Equal("dir::users", users.NodeId);
        Assert.True(users.AncestorHint);
    }

    [AvaloniaFact]
    public void Turning_Diff_off_restores_the_previous_view_and_removes_the_cards_and_recoloring()
    {
        var (window, _, view, _, button, _) = Open();
        var before = view.Expansion.ExpandedOrder.ToArray();
        Press(window, button);

        Press(window, button);

        Assert.Equal(DiffToggleButton.OffLabel, button.Label);
        Assert.Equal(before, view.Expansion.ExpandedOrder);
        Assert.Empty(view.ChangeCardPanels);
        Assert.Null(view.Diff!.StatusOf(CreateInvoice));
        Assert.Null(view.Scene.Find(CreateInvoice));
    }

    [AvaloniaFact]
    public void A_click_while_loading_cancels_so_a_hung_fetch_cannot_leave_the_button_stuck()
    {
        var (window, _, view, controller, button, bridge) = Open();
        bridge.Gate = new TaskCompletionSource<bool>();

        Press(window, button);
        var loading = (button.Label, button.IsEnabled);
        Press(window, button);
        bridge.Gate.SetResult(true);
        Settle();

        Assert.Equal((DiffToggleButton.PendingLabel, true), loading);
        Assert.Equal(DiffToggleButton.OffLabel, button.Label);
        Assert.False(view.Diff!.IsActive);
        Assert.Empty(view.Expansion.ExpandedOrder);
    }

    private static HierarchyCanvas OpenDiffPopup(Window window, HierarchyCanvas canvas, HierarchyView view, DiffToggleButton button)
    {
        Press(window, button);
        var rect = view.CodeButtonRect(CreateInvoice)!.Value;
        var at = view.Viewport.CanvasToScreen(new global::CodeChroma.Canvas.Geometry.Point(rect.CenterX, rect.CenterY));
        view.Viewport.Pan(700 - at.X, 400 - at.Y);
        rect = view.CodeButtonRect(CreateInvoice)!.Value;
        ClickAt(window, view, new global::CodeChroma.Canvas.Geometry.Point(rect.CenterX, rect.CenterY));
        canvas.UpdateLayout();
        return canvas;
    }

    [AvaloniaFact]
    public void Opening_a_diffed_function_shows_removed_and_added_lines_with_an_Accept_button()
    {
        var (window, canvas, view, _, button, _) = Open();

        OpenDiffPopup(window, canvas, view, button);
        var runs = canvas.Popup!.SourceBlock.Inlines!.OfType<Run>().ToList();

        Assert.NotNull(canvas.Popup.AcceptButton);
        Assert.Contains(runs, r => r.Text!.StartsWith("- ") && r.Text.Contains("return 1") && r.Background is not null && !Equals(r.Background, DiffBrushes.For(DiffLineKind.Context)));
        Assert.Contains(runs, r => r.Text!.StartsWith("+ ") && r.Text.Contains("return 2"));
    }

    [AvaloniaFact]
    public void Accept_commits_that_node_closes_the_popup_and_leaves_Diff_mode_active()
    {
        var (window, canvas, view, controller, button, bridge) = Open();
        OpenDiffPopup(window, canvas, view, button);

        Press(window, canvas.Popup!.AcceptButton!);
        controller.PendingRefresh.GetAwaiter().GetResult();
        Settle();

        Assert.Equal(new[] { CreateInvoice }, bridge.Accepted);
        Assert.Null(canvas.Popup);
        Assert.Null(view.Diff!.DiffOf(CreateInvoice));
        Assert.True(view.Diff.IsActive);
        Assert.Equal(DiffToggleButton.OnLabel, button.Label);
    }

    [AvaloniaFact]
    public void A_read_only_workspace_still_shows_the_diff_but_offers_no_Accept()
    {
        var (window, canvas, view, _, button, _) = Open(readOnly: true);

        OpenDiffPopup(window, canvas, view, button);

        Assert.NotNull(canvas.Popup);
        Assert.Null(canvas.Popup!.AcceptButton);
        Assert.Contains(canvas.Popup.SourceBlock.Inlines!.OfType<Run>(), r => r.Text!.StartsWith("+ "));
    }

    [AvaloniaFact]
    public void Rendering_a_frame_with_diffs_cards_and_recolored_blocks_does_not_throw()
    {
        var (window, _, view, _, button, _) = Open();
        Press(window, button);
        view.FitAll();

        var ex = Record.Exception(() => { window.UpdateLayout(); view.InvalidateVisual(); AvaloniaHeadlessPlatform.ForceRenderTimerTick(); });

        Assert.Null(ex);
        Assert.NotEmpty(view.RealisedBoxes);
    }
}
