using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Layout;
using Avalonia.Media;

namespace CodeChroma.Shell.App;

/// <summary>Builds the agent-status visuals of the tab strip (dot, badge) from the App.axaml tokens.</summary>
public static class AgentChrome
{
    public static IBrush Brush(string key) =>
        Application.Current?.FindResource(key) as IBrush ?? Brushes.Transparent;

    public static FontFamily Font(string key) =>
        Application.Current?.FindResource(key) as FontFamily ?? FontFamily.Default;

    public static Control? Dot(string? status, double size = 8) => status switch
    {
        "blocked" => Pulse(size),
        "error" => new Border { Width = size, Height = size, CornerRadius = new CornerRadius(2), Background = Brush("StatusErrorBrush"), VerticalAlignment = VerticalAlignment.Center },
        "done" => new Ellipse { Width = size, Height = size, Fill = Brush("StatusDoneBrush"), VerticalAlignment = VerticalAlignment.Center },
        "working" => Spinner(size + 2),
        _ => null,
    };

    public static Control Spinner(double size)
    {
        var spinner = new Panel { Width = size, Height = size, VerticalAlignment = VerticalAlignment.Center, RenderTransform = new RotateTransform(), Classes = { "spin" } };
        spinner.Children.Add(new Ellipse { Stroke = Brush("StatusWorkingTrackBrush"), StrokeThickness = 2, Margin = new Thickness(1) });
        spinner.Children.Add(new Arc { Stroke = Brush("StatusWorkingBrush"), StrokeThickness = 2, Margin = new Thickness(1), StartAngle = -135, SweepAngle = 90 });
        return spinner;
    }

    public static Control IdleRing(double size) =>
        new Ellipse { Width = size, Height = size, Stroke = Brush("StatusIdleBrush"), StrokeThickness = 2, VerticalAlignment = VerticalAlignment.Center };

    public static Control? Badge(string? status, int count)
    {
        if (count <= 0) return null;
        var (background, foreground) = status switch
        {
            "blocked" => ("StatusBlockedBrush", "StatusBlockedInkBrush"),
            "error" => ("StatusErrorBadgeBrush", "StatusErrorBrush"),
            _ => ("StatusDoneBadgeBrush", "StatusDoneBrush"),
        };
        return new Border
        {
            MinWidth = 18,
            Height = 18,
            Padding = new Thickness(5, 0),
            CornerRadius = new CornerRadius(9),
            Background = Brush(background),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock { Text = count.ToString(), FontSize = 11, FontWeight = FontWeight.Bold, Foreground = Brush(foreground), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center },
        };
    }

    private static Control Pulse(double size)
    {
        var dot = new Panel { Width = size, Height = size, VerticalAlignment = VerticalAlignment.Center };
        dot.Children.Add(new Ellipse { Fill = Brush("StatusBlockedBrush"), RenderTransform = new ScaleTransform(), Classes = { "pulse" }, IsHitTestVisible = false });
        dot.Children.Add(new Ellipse { Fill = Brush("StatusBlockedBrush") });
        return dot;
    }
}
